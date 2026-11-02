"use client";

import { Col, Row, Tag } from "antd";
import { PageHeader } from "@/components/common/PageHeader";
import { Section } from "@/components/common/Section";
import { StatStrip } from "@/components/common/StatStrip";
import { ErrorState } from "@/components/common/feedback";
import { formatCount } from "@/lib/format/units";
import { useCommStats } from "../hooks/use-federation";
import { ComposeCard } from "./ComposeCard";
import { MessageLog } from "./MessageLog";

export function FederationView() {
  const { data, isLoading, error, refetch } = useCommStats();

  return (
    <>
      <PageHeader title="Federation" note={data ? `${data.node}${data.node_ip ? ` · ${data.node_ip}` : ""}` : undefined} />
      {error && !data ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <StatStrip
            loading={isLoading}
            stats={[
              { label: "Peers", value: String(data?.peer_count ?? 0), tone: data && data.peer_count === 0 ? "warning" : undefined },
              { label: "Broadcast sent", value: formatCount(data?.broadcast) },
              { label: "Unicast sent", value: formatCount(data?.unicast) },
              { label: "Multicast sent", value: formatCount(data?.multicast) },
              { label: "Received", value: formatCount(data?.received) },
            ]}
          />
          <div style={{ height: 24 }} />
          <Row gutter={24}>
            <Col xs={24} lg={9}>
              <Section title="Send message">
                <ComposeCard />
              </Section>
              <Section title="Peers">
                {data?.peers?.length ? data.peers.map((p) => <Tag key={p}>{p}</Tag>) : "No peers discovered."}
              </Section>
            </Col>
            <Col xs={24} lg={15}>
              <Section title="Message history">
                <MessageLog />
              </Section>
            </Col>
          </Row>
        </>
      )}
    </>
  );
}
