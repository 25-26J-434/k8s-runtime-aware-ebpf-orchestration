package scaling

import (
	"context"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

var (
	mongoClient *mongo.Client
	collection  *mongo.Collection
	initOnce    sync.Once
)

// InitMongo initializes MongoDB connection (safe to call multiple times)
func InitMongo() error {
	var initErr error

	initOnce.Do(func() {
		uri := os.Getenv("MONGO_URI")
		if uri == "" {
			uri = "mongodb://mongo.rules-db.svc.cluster.local:27017"
		}

		dbName := os.Getenv("MONGO_DB")
		if dbName == "" {
			dbName = "rulesdb"
		}

		colName := os.Getenv("MONGO_COLLECTION")
		if colName == "" {
			colName = "scaling_rules"
		}

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
		if err != nil {
			initErr = fmt.Errorf("mongo connect failed: %w", err)
			return
		}

		if err := client.Ping(ctx, nil); err != nil {
			initErr = fmt.Errorf("mongo ping failed: %w", err)
			return
		}

		mongoClient = client
		collection = mongoClient.Database(dbName).Collection(colName)

		log.Printf("[Scaling] Mongo connected (%s / %s)", dbName, colName)
	})

	return initErr
}

// MongoDB exposes the mongo client safely
func MongoDB() *mongo.Client {
	return mongoClient
}

// GetEnabledScalingRules fetches enabled scaling rules
func GetEnabledScalingRules() ([]ScalingRule, error) {
	if mongoClient == nil || collection == nil {
		return nil, fmt.Errorf("mongo not initialized")
	}

	filter := bson.M{"enabled": true}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cur, err := collection.Find(ctx, filter)
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)

	var rules []ScalingRule
	if err := cur.All(ctx, &rules); err != nil {
		return nil, err
	}

	// Safe defaults
	for i := range rules {
		if rules[i].Operator == "" {
			rules[i].Operator = ">"
		}
		if rules[i].MinReplicas == 0 {
			rules[i].MinReplicas = 1
		}
		if rules[i].MaxReplicas == 0 {
			rules[i].MaxReplicas = 5
		}
		if rules[i].Step == 0 {
			rules[i].Step = 1
		}
	}

	return rules, nil
}
