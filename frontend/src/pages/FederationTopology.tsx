import React, { useRef, useEffect } from 'react';

// Types for nodes and links (should match Federation.tsx)
export interface ClusterNode {
  name: string;
  ip: string;
  status: string;
  role?: string;
  podCount: number;
  runningPods: number;
  kernelVersion?: string;
  osImage?: string;
}

export interface TopologyLink {
  source: string; // node ip or name
  target: string; // node ip or name
  type?: string;
}

interface FederationTopologyProps {
  nodes: ClusterNode[];
  links: TopologyLink[];
}

// Minimal D3 force-directed graph (no external lib, just SVG)
export function FederationTopology({ nodes, links }: FederationTopologyProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Simple layout: arrange nodes in a circle
  const size = 400;
  const radius = size / 2 - 60;
  const center = size / 2;
  const nodeCount = nodes.length;
  const nodePositions = nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / nodeCount;
    return {
      ...node,
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
    };
  });

  // Helper to get node position by ip or name
  const getNodePos = (id: string) =>
    nodePositions.find((n) => n.ip === id || n.name === id) || nodePositions[0];

  return (
    <div style={{ width: '100%', minHeight: 240, background: '#181e2a', borderRadius: 12, marginBottom: 24, overflow: 'auto' }}>
      <svg ref={svgRef} width={size} height={size} style={{ display: 'block', margin: '0 auto' }}>
        {/* Draw links */}
        {links.map((link, i) => {
          const src = getNodePos(link.source);
          const tgt = getNodePos(link.target);
          return (
            <line
              key={i}
              x1={src.x}
              y1={src.y}
              x2={tgt.x}
              y2={tgt.y}
              stroke="#38bdf8"
              strokeWidth={2}
              opacity={0.5}
              markerEnd="url(#arrowhead)"
            />
          );
        })}
        {/* Arrowhead marker */}
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto" markerUnits="strokeWidth">
            <polygon points="0 0, 8 4, 0 8" fill="#38bdf8" />
          </marker>
        </defs>
        {/* Draw nodes */}
        {nodePositions.map((node, i) => (
          <g key={node.ip}>
            <circle
              cx={node.x}
              cy={node.y}
              r={28}
              fill={node.status === 'Ready' ? '#10b981' : '#f59e0b'}
              stroke="#334155"
              strokeWidth={3}
            />
            <text
              x={node.x}
              y={node.y - 6}
              textAnchor="middle"
              fill="#fff"
              fontSize={14}
              fontWeight="bold"
            >
              {node.name}
            </text>
            <text
              x={node.x}
              y={node.y + 14}
              textAnchor="middle"
              fill="#94a3b8"
              fontSize={11}
            >
              {node.ip}
            </text>
          </g>
        ))}
      </svg>
      {nodeCount === 0 && (
        <div style={{ color: '#94a3b8', fontSize: 18, textAlign: 'center', padding: 32 }}>
          [ No nodes to display ]
        </div>
      )}
    </div>
  );
}
