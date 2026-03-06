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
var dnatAttachPath string
var dnatLoadErr error
var dnatAttachErr error

func LoadDNATBPF() error {
	log.Println("[Loader] Loading DNAT connect4 BPF program...")

	if len(dnatObj) == 0 {
		log.Println("[Loader] WARNING: DNAT BPF object is empty - DNAT disabled")
		dnatLoadErr = fmt.Errorf("embedded DNAT BPF object is empty - ensure dnat_connect4.o is compiled")
		return dnatLoadErr
	}

	spec, err := ebpf.LoadCollectionSpecFromReader(bytes.NewReader(dnatObj))
	if err != nil {
		dnatLoadErr = fmt.Errorf("failed to load DNAT collection spec: %w", err)
		return dnatLoadErr
	}
	DNATSpec = spec

	objs, err := ebpf.NewCollection(DNATSpec)
	if err != nil {
		dnatLoadErr = fmt.Errorf("failed to create DNAT collection: %w", err)
		return dnatLoadErr
	}
	DNATObjs = objs

	DNATMap = DNATObjs.Maps["dnat_map"]
	if DNATMap == nil {
		dnatLoadErr = fmt.Errorf("dnat_map not found in DNAT collection")
		return dnatLoadErr
	}

	log.Println("[Loader] DNAT BPF programs loaded successfully")
	dnatLoadErr = nil
	return nil
}

func AttachDNATCgroup() error {
	if DNATObjs == nil {
		dnatAttachErr = fmt.Errorf("DNAT collection not loaded")
		return dnatAttachErr
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
	dnatAttachPath = cgroupPath

	lnk, err := link.AttachCgroup(link.CgroupOptions{
		Path:    cgroupPath,
		Attach:  ebpf.AttachCGroupInet4Connect,
		Program: prog,
	})
	if err != nil {
		dnatAttachErr = fmt.Errorf("failed to attach cgroup/connect4: %w", err)
		return dnatAttachErr
	}
	dnatCgroupLink = lnk
	log.Printf("[Loader] DNAT connect4 attached to cgroup: %s", cgroupPath)
	dnatAttachErr = nil
	return nil
}

func DNATMapHandle() *ebpf.Map {
	return DNATMap
}

type DNATStatus struct {
	Loaded       bool   `json:"loaded"`
	LoadError    string `json:"load_error,omitempty"`
	Attached     bool   `json:"attached"`
	AttachError  string `json:"attach_error,omitempty"`
	AttachPath   string `json:"attach_path,omitempty"`
	MapAvailable bool   `json:"map_available"`
}

func GetDNATStatus() DNATStatus {
	status := DNATStatus{
		Loaded:       DNATObjs != nil,
		Attached:     dnatCgroupLink != nil,
		AttachPath:   dnatAttachPath,
		MapAvailable: DNATMap != nil,
	}
	if dnatLoadErr != nil {
		status.LoadError = dnatLoadErr.Error()
	}
	if dnatAttachErr != nil {
		status.AttachError = dnatAttachErr.Error()
	}
	return status
}
