package main

import (
	"context"
	"errors"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/scaling/scheduler"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

func main() {
	log.Println("[Scheduler] Starting KernelEye scheduler")

	if loadEnv() {
		log.Println("[Scheduler] Loaded environment from .env")
	}

	cfg, err := scheduler.LoadConfigFromEnv()
	if err != nil {
		log.Fatalf("[Scheduler] Invalid configuration: %v", err)
	}

	client, err := newKubernetesClient()
	if err != nil {
		log.Fatalf("[Scheduler] Failed to initialize Kubernetes client: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	s, err := scheduler.New(client, cfg)
	if err != nil {
		log.Fatalf("[Scheduler] Failed to initialize scheduler: %v", err)
	}

	if err := s.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatalf("[Scheduler] Exited with error: %v", err)
	}
}

func newKubernetesClient() (*kubernetes.Clientset, error) {
	config, err := rest.InClusterConfig()
	if err != nil {
		kubeconfig := os.Getenv("KUBECONFIG")
		if kubeconfig == "" {
			home, _ := os.UserHomeDir()
			kubeconfig = filepath.Join(home, ".kube", "config")
		}

		config, err = clientcmd.BuildConfigFromFlags("", kubeconfig)
		if err != nil {
			return nil, err
		}
	}

	return kubernetes.NewForConfig(config)
}

func loadEnv() bool {
	loaded := loadEnvFile(".env")
	if loadEnvFile("../.env") {
		loaded = true
	}
	return loaded
}

func loadEnvFile(path string) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}

	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}

		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}

		key := strings.TrimSpace(parts[0])
		if key == "" || os.Getenv(key) != "" {
			continue
		}

		val := strings.Trim(strings.TrimSpace(parts[1]), `"'`)
		_ = os.Setenv(key, val)
	}

	return true
}
