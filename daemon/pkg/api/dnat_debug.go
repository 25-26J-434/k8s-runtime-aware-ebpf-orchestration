package api

import (
	"encoding/binary"
	"net"
	"net/http"
	"os"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/loader"
)

type dnatEntry struct {
	ServiceIP   string `json:"service_ip"`
	ServicePort uint16 `json:"service_port"`
	TargetIP    string `json:"target_ip"`
	TargetPort  uint16 `json:"target_port"`
}

type dnatDumpResponse struct {
	Node    string      `json:"node"`
	Entries []dnatEntry `json:"entries"`
}

type dnatKey struct {
	DstIP   uint32
	DstPort uint16
	Pad     uint16
}

type dnatVal struct {
	TargetIP   uint32
	TargetPort uint16
	Pad        uint16
}

func handleDNATEntries(w http.ResponseWriter, r *http.Request) {
	dnatMap := loader.DNATMapHandle()
	if dnatMap == nil {
		http.Error(w, "dnat map not available", http.StatusServiceUnavailable)
		return
	}

	iter := dnatMap.Iterate()
	var key dnatKey
	var val dnatVal
	entries := []dnatEntry{}
	for iter.Next(&key, &val) {
		entries = append(entries, dnatEntry{
			ServiceIP:   ipv4FromNetOrder(key.DstIP),
			ServicePort: ntohs(key.DstPort),
			TargetIP:    ipv4FromNetOrder(val.TargetIP),
			TargetPort:  ntohs(val.TargetPort),
		})
	}

	if err := iter.Err(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	resp := dnatDumpResponse{
		Node:    os.Getenv("NODE_NAME"),
		Entries: entries,
	}
	writeJSON(w, resp)
}

func handleDNATStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, loader.GetDNATStatus())
}

func ipv4FromNetOrder(v uint32) string {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, v)
	return net.IP(b).String()
}

func ntohs(port uint16) uint16 {
	return (port<<8)&0xff00 | port>>8
}
