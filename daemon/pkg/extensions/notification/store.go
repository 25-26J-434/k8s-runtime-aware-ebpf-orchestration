// Package notification stores extension config (thresholds, webhook, etc.) in MongoDB.
// Uses the same MongoDB URL pattern as the rest of the daemon (see redirection/store.go).
// Collection: extension_notification_config. Env: EXTENSION_MONGO_URI or MONGODB_URI.
package notification

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/spi"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const configDocKey = "default"

type configDoc struct {
	Key       string                 `bson:"key"`
	Config    map[string]interface{} `bson:"config"`
	UpdatedAt time.Time              `bson:"updated_at"`
}

var notificationStore struct {
	client *mongo.Client
	coll   *mongo.Collection
}

// InitStore connects to MongoDB and sets the notification config collection.
// Uses EXTENSION_MONGO_URI or MONGODB_URI; db defaults to kerneleye, collection to extension_notification_config.
func InitStore(ctx context.Context) error {
	uri := firstNonEmpty(
		os.Getenv("EXTENSION_MONGO_URI"),
		os.Getenv("MONGODB_URI"),
		"mongodb://mongo.mongo.svc.cluster.local:27017/kerneleye?replicaSet=rs0",
	)
	dbName := firstNonEmpty(os.Getenv("EXTENSION_MONGO_DB"), "kerneleye")
	collName := firstNonEmpty(os.Getenv("EXTENSION_MONGO_COLLECTION"), "extension_notification_config")

	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		return err
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx, nil); err != nil {
		return err
	}
	notificationStore.client = client
	notificationStore.coll = client.Database(dbName).Collection(collName)
	log.Printf("[Notification] Store connected (db=%s collection=%s)", dbName, collName)
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// LoadConfigFromStore loads the saved config from MongoDB and applies it in memory (SetConfig).
// Safe to call if InitStore was not called or failed (no-op).
// Always decodes via raw bson.M and extracts "config" so email/webhooks/thresholds load reliably
// regardless of how the driver decodes subdocuments into map[string]interface{}.
func LoadConfigFromStore(ctx context.Context) {
	if notificationStore.coll == nil {
		log.Printf("[Notification] [EMAIL] LoadConfigFromStore: no MongoDB collection (InitStore not run or failed)")
		return
	}
	var rawDoc bson.M
	err := notificationStore.coll.FindOne(ctx, bson.M{"key": configDocKey}).Decode(&rawDoc)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			log.Printf("[Notification] [EMAIL] LoadConfigFromStore: no document in DB (key=%s)", configDocKey)
		} else {
			log.Printf("[Notification] [EMAIL] LoadConfigFromStore: %v", err)
		}
		return
	}
	c, ok := rawDoc["config"]
	if !ok || c == nil {
		log.Printf("[Notification] [EMAIL] LoadConfigFromStore: document has no config field")
		return
	}
	raw := docFromBSONValue(c)
	if raw == nil {
		log.Printf("[Notification] [EMAIL] LoadConfigFromStore: could not convert config to map (type %T)", c)
		return
	}
	// Normalize so primitive.A etc. become []interface{} and types are JSON-safe for SPI helpers.
	normalized := normalizeBSONConfig(raw)
	SetConfig(spi.ExtensionParams{Config: normalized})
	// Log email-related keys so we can see what was loaded (no passwords)
	emailEnabled := false
	if v, ok := normalized["email_enabled"]; ok {
		if b, ok := v.(bool); ok && b {
			emailEnabled = true
		}
	}
	smtpHost, _ := normalized["smtp_host"].(string)
	if smtpHost == "" {
		if s, ok := normalized["smtp_host"]; ok {
			smtpHost = fmt.Sprintf("%v", s)
		}
	}
	log.Printf("[Notification] [EMAIL] LoadConfigFromStore: OK | email_enabled=%v smtp_host=%q (thresholds, webhooks applied)", emailEnabled, strings.TrimSpace(smtpHost))
}

// docFromBSONValue converts a BSON subdocument (map, primitive.D, or primitive.M) to map[string]interface{}.
func docFromBSONValue(v interface{}) map[string]interface{} {
	if m, ok := v.(map[string]interface{}); ok {
		return m
	}
	if m, ok := v.(primitive.M); ok {
		return map[string]interface{}(m)
	}
	if d, ok := v.(primitive.D); ok {
		out := make(map[string]interface{}, len(d))
		for _, e := range d {
			out[e.Key] = e.Value
		}
		return out
	}
	return nil
}

// normalizeBSONConfig converts BSON-specific types (e.g. primitive.A, primitive.D, primitive.M)
// to plain Go types ([]interface{}, map[string]interface{}) via a JSON round-trip.
// This is required because the MongoDB driver decodes arrays as primitive.A, which cannot
// be type-asserted to []interface{} and would silently break the webhooks/thresholds parsing.
func normalizeBSONConfig(in map[string]interface{}) map[string]interface{} {
	b, err := json.Marshal(in)
	if err != nil {
		log.Printf("[Notification] normalizeBSONConfig marshal error: %v", err)
		return in
	}
	var out map[string]interface{}
	if err := json.Unmarshal(b, &out); err != nil {
		log.Printf("[Notification] normalizeBSONConfig unmarshal error: %v", err)
		return in
	}
	return out
}

// SaveConfigToStore persists the given config to MongoDB.
// Then applies it in memory via SetConfig.
func SaveConfigToStore(ctx context.Context, config map[string]interface{}) error {
	if notificationStore.coll == nil {
		SetConfig(spi.ExtensionParams{Config: config})
		return nil
	}
	doc := configDoc{
		Key:       configDocKey,
		Config:    config,
		UpdatedAt: time.Now().UTC(),
	}
	opts := options.Update().SetUpsert(true)
	_, err := notificationStore.coll.UpdateOne(ctx,
		bson.M{"key": configDocKey},
		bson.M{"$set": bson.M{"key": configDocKey, "config": doc.Config, "updated_at": doc.UpdatedAt}},
		opts,
	)
	if err != nil {
		return err
	}
	SetConfig(spi.ExtensionParams{Config: config})
	return nil
}
