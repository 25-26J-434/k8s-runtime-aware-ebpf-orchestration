// Package notification stores extension config (thresholds, webhook, etc.) in MongoDB.
// Uses the same MongoDB URL pattern as the rest of the daemon (see redirection/store.go).
// Collection: extension_notification_config. Env: EXTENSION_MONGO_URI or MONGODB_URI.
package notification

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/spi"
	"go.mongodb.org/mongo-driver/bson"
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
func LoadConfigFromStore(ctx context.Context) {
	if notificationStore.coll == nil {
		return
	}
	var doc configDoc
	err := notificationStore.coll.FindOne(ctx, bson.M{"key": configDocKey}).Decode(&doc)
	if err != nil {
		if err != mongo.ErrNoDocuments {
			log.Printf("[Notification] LoadConfigFromStore: %v", err)
		}
		return
	}
	if doc.Config != nil {
		SetConfig(spi.ExtensionParams{Config: doc.Config})
		log.Printf("[Notification] Loaded saved config from store (threshold etc.)")
	}
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
