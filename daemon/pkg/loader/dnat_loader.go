package loader

import (
	"bytes"
	"fmt"
	"log"
	"os"

	_ "embed"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
)

//go:embed bpf/dnat_connect4.o
var dnatObj []byte

var DNATSpec *ebpf.CollectionSpec
var DNATObjs *ebpf.Collection
var DNATMap *ebpf.Map

var dnatCgroupLink link.Link

func LoadDNATBPF() error {
	log.Println("[Loader] Loading DNAT connect4 BPF program...")

	if len(dnatObj) == 0 {
		log.Println("[Loader] WARNING: DNAT BPF object is empty - DNAT disabled")
		return fmt.Errorf("embedded DNAT BPF object is empty - ensure dnat_connect4.o is compiled")
	}

	spec, err := ebpf.LoadCollectionSpecFromReader(bytes.NewReader(dnatObj))
	if err != nil {
		return fmt.Errorf("failed to load DNAT collection spec: %w", err)
	}
	DNATSpec = spec

	objs, err := ebpf.NewCollection(DNATSpec)
	if err != nil {
		return fmt.Errorf("failed to create DNAT collection: %w", err)
	}
	DNATObjs = objs

	DNATMap = DNATObjs.Maps["dnat_map"]
	if DNATMap == nil {
		return fmt.Errorf("dnat_map not found in DNAT collection")
	}

	log.Println("[Loader] DNAT BPF programs loaded successfully")
	return nil
}

func AttachDNATCgroup() error {
	if DNATObjs == nil {
		return fmt.Errorf("DNAT collection not loaded")
	}

	prog := DNATObjs.Programs["dnat_connect4"]
	if prog == nil {
		return fmt.Errorf("program 'dnat_connect4' not found")
	}

	cgroupPath := os.Getenv("EBPF_CGROUP_PATH")
	if cgroupPath == "" {
		cgroupPath = "/sys/fs/cgroup"
		if _, err := os.Stat("/sys/fs/cgroup/kubepods.slice"); err == nil {
			cgroupPath = "/sys/fs/cgroup/kubepods.slice"
		}
	}

	lnk, err := link.AttachCgroup(link.CgroupOptions{
		Path:    cgroupPath,
		Attach:  ebpf.AttachCGroupInet4Connect,
		Program: prog,
	})
	if err != nil {
		return fmt.Errorf("failed to attach cgroup/connect4: %w", err)
	}
	dnatCgroupLink = lnk
	log.Printf("[Loader] DNAT connect4 attached to cgroup: %s", cgroupPath)
	return nil
}

func DNATMapHandle() *ebpf.Map {
	return DNATMap
}
