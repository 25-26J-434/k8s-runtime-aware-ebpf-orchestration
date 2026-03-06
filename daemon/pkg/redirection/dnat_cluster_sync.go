package redirection

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/loader"
	"github.com/cilium/ebpf"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/watch"
)

const dnatRedirectConfigMapName = "ebpf-dnat-redirects"

type dnatRedirectSpec struct {
	ServiceIP   string    `json:"service_ip"`
	ServicePort int       `json:"service_port"`
	TargetIP    string    `json:"target_ip"`
	TargetPort  int       `json:"target_port"`
	ExpiresAt   time.Time `json:"expires_at"`
	PolicyName  string    `json:"policy_name"`
}

func dnatPolicyKey(p *Policy) string {
	return fmt.Sprintf("%s_%s_%d", p.Namespace, p.Frontend.Service, p.Frontend.Port)
}

func (e *Engine) publishClusterDNAT(ctx context.Context, p *Policy, svc *corev1.Service, winner *corev1.Pod) error {
	if e.kube == nil {
		return fmt.Errorf("kubernetes client not initialized")
	}
	if p == nil || svc == nil || winner == nil {
		return fmt.Errorf("policy/service/winner is nil")
	}
	if svc.Spec.ClusterIP == "" || svc.Spec.ClusterIP == "None" {
		return fmt.Errorf("service %s has no cluster IP", svc.Name)
	}
	if winner.Status.PodIP == "" {
		return fmt.Errorf("winner pod has no IP")
	}
	if p.Frontend.Port <= 0 || p.Action.BackendPort <= 0 {
		return fmt.Errorf("frontend and backend ports must be set")
	}

	spec := dnatRedirectSpec{
		ServiceIP:   svc.Spec.ClusterIP,
		ServicePort: p.Frontend.Port,
		TargetIP:    winner.Status.PodIP,
		TargetPort:  p.Action.BackendPort,
		ExpiresAt:   time.Now().UTC().Add(time.Duration(p.Action.TTLSeconds) * time.Second),
		PolicyName:  p.PolicyName,
	}
	raw, err := json.Marshal(spec)
	if err != nil {
		return err
	}

	cmClient := e.kube.CoreV1().ConfigMaps(e.syncNamespace)
	cm, err := cmClient.Get(ctx, dnatRedirectConfigMapName, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		cm = &corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{
				Name:      dnatRedirectConfigMapName,
				Namespace: e.syncNamespace,
			},
			Data: map[string]string{},
		}
		cm.Data[dnatPolicyKey(p)] = string(raw)
		if _, err = cmClient.Create(ctx, cm, metav1.CreateOptions{}); err != nil {
			return err
		}
		e.logger.Printf("[Routing] cluster DNAT published %s in %s (created)", dnatPolicyKey(p), e.syncNamespace)
		return nil
	}
	if err != nil {
		return err
	}

	if cm.Data == nil {
		cm.Data = map[string]string{}
	}
	cm.Data[dnatPolicyKey(p)] = string(raw)
	if _, err = cmClient.Update(ctx, cm, metav1.UpdateOptions{}); err != nil {
		return err
	}
	e.logger.Printf("[Routing] cluster DNAT published %s in %s (updated)", dnatPolicyKey(p), e.syncNamespace)
	return nil
}

func (e *Engine) removeClusterDNAT(ctx context.Context, p *Policy) error {
	if e.kube == nil {
		return fmt.Errorf("kubernetes client not initialized")
	}
	cmClient := e.kube.CoreV1().ConfigMaps(e.syncNamespace)
	cm, err := cmClient.Get(ctx, dnatRedirectConfigMapName, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if cm.Data == nil {
		return nil
	}
	delete(cm.Data, dnatPolicyKey(p))
	_, err = cmClient.Update(ctx, cm, metav1.UpdateOptions{})
	return err
}

// StartClusterDNATSync watches the redirect ConfigMap and keeps the local DNAT BPF map in sync.
func (e *Engine) StartClusterDNATSync(ctx context.Context) {
	if e.kube == nil {
		e.logger.Printf("[Routing] DNAT sync disabled: kubernetes client not initialized")
		return
	}

	go func() {
		e.logger.Printf("[Routing] DNAT sync watching ConfigMap %s/%s", e.syncNamespace, dnatRedirectConfigMapName)

		for {
			if ctx.Err() != nil {
				return
			}

			e.fetchAndReconcileClusterDNAT(ctx)

			w, err := e.kube.CoreV1().ConfigMaps(e.syncNamespace).Watch(ctx, metav1.ListOptions{
				FieldSelector: "metadata.name=" + dnatRedirectConfigMapName,
			})
			if err != nil {
				e.logger.Printf("[Routing] DNAT sync watch failed: %v", err)
				time.Sleep(2 * time.Second)
				continue
			}

			e.consumeDNATWatch(ctx, w)
			time.Sleep(250 * time.Millisecond)
		}
	}()
}

func (e *Engine) fetchAndReconcileClusterDNAT(ctx context.Context) {
	cm, err := e.kube.CoreV1().ConfigMaps(e.syncNamespace).Get(ctx, dnatRedirectConfigMapName, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		e.reconcileDNATFromConfigMap(&corev1.ConfigMap{Data: map[string]string{}})
		return
	}
	if err != nil || cm == nil {
		if err != nil {
			e.logger.Printf("[Routing] DNAT sync fetch failed: %v", err)
		}
		return
	}
	e.reconcileDNATFromConfigMap(cm)
}

func (e *Engine) consumeDNATWatch(ctx context.Context, w watch.Interface) {
	defer w.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case evt, ok := <-w.ResultChan():
			if !ok {
				return
			}
			if evt.Type == watch.Error {
				return
			}
			cm, ok := evt.Object.(*corev1.ConfigMap)
			if !ok || cm == nil {
				continue
			}
			e.reconcileDNATFromConfigMap(cm)
		}
	}
}

func (e *Engine) reconcileDNATFromConfigMap(cm *corev1.ConfigMap) {
	dnatMap := loader.DNATMapHandle()
	if dnatMap == nil {
		if e.localNodeName != "" {
			e.logger.Printf("[Routing] DNAT sync skipped: DNAT map not available on node %s", e.localNodeName)
		}
		return
	}

	now := time.Now().UTC()
	seen := map[string]dnatKey{}

	applyCount := 0
	for k, v := range cm.Data {
		var spec dnatRedirectSpec
		if err := json.Unmarshal([]byte(v), &spec); err != nil {
			e.logger.Printf("[Routing] DNAT sync: invalid entry %q: %v", k, err)
			continue
		}
		if !spec.ExpiresAt.IsZero() && now.After(spec.ExpiresAt) {
			continue
		}
		if spec.ServiceIP == "" || spec.TargetIP == "" || spec.ServicePort <= 0 || spec.TargetPort <= 0 {
			continue
		}

		serviceIP, err := parseIPv4NetOrder(spec.ServiceIP)
		if err != nil {
			continue
		}
		targetIP, err := parseIPv4NetOrder(spec.TargetIP)
		if err != nil {
			continue
		}

		key := dnatKey{DstIP: serviceIP, DstPort: htons(uint16(spec.ServicePort))}
		val := dnatVal{TargetIP: targetIP, TargetPort: htons(uint16(spec.TargetPort))}
		if err := dnatMap.Update(&key, &val, ebpf.UpdateAny); err != nil {
			e.logger.Printf("[Routing] DNAT sync: map update failed for %q: %v", k, err)
			continue
		}
		seen[k] = key
		applyCount++
	}

	// Remove mappings that were previously applied from the ConfigMap but are no longer present.
	e.dnatSyncMu.Lock()
	defer e.dnatSyncMu.Unlock()
	for k, oldKey := range e.dnatSyncKeys {
		if _, ok := seen[k]; ok {
			continue
		}
		if err := dnatMap.Delete(&oldKey); err != nil && !errors.Is(err, ebpf.ErrKeyNotExist) {
			e.logger.Printf("[Routing] DNAT sync: map delete failed for %q: %v", k, err)
		}
		delete(e.dnatSyncKeys, k)
	}
	for k, newKey := range seen {
		e.dnatSyncKeys[k] = newKey
	}
	if applyCount > 0 {
		nodeLabel := e.localNodeName
		if nodeLabel == "" {
			nodeLabel = "unknown"
		}
		e.logger.Printf("[Routing] DNAT sync applied %d entries on node %s", applyCount, nodeLabel)
	}
}
