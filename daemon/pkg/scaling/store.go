package scaling

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

var (
	mongoClient *mongo.Client
	collection  *mongo.Collection
	initOnce    sync.Once
)

var ErrRuleNotFound = errors.New("scaling rule not found")

// InitMongo initializes MongoDB connection (safe to call multiple times)
func InitMongo() error {
	var initErr error

	initOnce.Do(func() {
		uri := os.Getenv("MONGO_URI")
		if uri == "" {
			uri = "mongodb://mongo.mongo.svc.cluster.local:27017/kerneleye?replicaSet=rs0"
		}

		dbName := os.Getenv("MONGO_DB")
		if dbName == "" {
			dbName = "kerneleye"
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

// WatchRuleChanges emits a signal whenever scaling rules change.
func WatchRuleChanges(ctx context.Context) (<-chan struct{}, error) {
	if mongoClient == nil || collection == nil {
		return nil, fmt.Errorf("mongo not initialized")
	}

	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"operationType": bson.M{"$in": []string{"insert", "update", "replace", "delete"}}}}},
	}
	opts := options.ChangeStream().SetFullDocument(options.UpdateLookup)

	stream, err := collection.Watch(ctx, pipeline, opts)
	if err != nil {
		return nil, err
	}

	events := make(chan struct{}, 1)

	go func() {
		defer close(events)
		defer stream.Close(ctx)

		for stream.Next(ctx) {
			select {
			case events <- struct{}{}:
			default:
			}
		}
	}()

	return events, nil
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

	for i := range rules {
		applyDefaults(&rules[i])
	}

	return rules, nil
}

// GetScalingRules fetches all scaling rules.
func GetScalingRules() ([]ScalingRule, error) {
	if mongoClient == nil || collection == nil {
		return nil, fmt.Errorf("mongo not initialized")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cur, err := collection.Find(ctx, bson.M{})
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)

	var rules []ScalingRule
	if err := cur.All(ctx, &rules); err != nil {
		return nil, err
	}

	for i := range rules {
		applyDefaults(&rules[i])
	}

	return rules, nil
}

// CreateScalingRule inserts a new scaling rule.
func CreateScalingRule(rule ScalingRule) (ScalingRule, error) {
	if mongoClient == nil || collection == nil {
		return ScalingRule{}, fmt.Errorf("mongo not initialized")
	}

	applyDefaults(&rule)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	res, err := collection.InsertOne(ctx, rule)
	if err != nil {
		return ScalingRule{}, err
	}

	if oid, ok := res.InsertedID.(primitive.ObjectID); ok {
		rule.ID = oid
	}

	return rule, nil
}

// UpdateScalingRule updates an existing scaling rule by ID.
func UpdateScalingRule(id primitive.ObjectID, updates bson.M) (ScalingRule, error) {
	if mongoClient == nil || collection == nil {
		return ScalingRule{}, fmt.Errorf("mongo not initialized")
	}
	if len(updates) == 0 {
		return ScalingRule{}, fmt.Errorf("no updates provided")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var updated ScalingRule
	if err := collection.FindOneAndUpdate(ctx, bson.M{"_id": id}, bson.M{"$set": updates}, opts).Decode(&updated); err != nil {
		return ScalingRule{}, err
	}

	applyDefaults(&updated)
	return updated, nil
}

// ToggleScalingRule flips the enabled flag for a rule.
func ToggleScalingRule(id primitive.ObjectID) (ScalingRule, error) {
	if mongoClient == nil || collection == nil {
		return ScalingRule{}, fmt.Errorf("mongo not initialized")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var current ScalingRule
	if err := collection.FindOne(ctx, bson.M{"_id": id}).Decode(&current); err != nil {
		return ScalingRule{}, err
	}

	updates := bson.M{"enabled": !current.Enabled}
	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var updated ScalingRule
	if err := collection.FindOneAndUpdate(ctx, bson.M{"_id": id}, bson.M{"$set": updates}, opts).Decode(&updated); err != nil {
		return ScalingRule{}, err
	}

	applyDefaults(&updated)
	return updated, nil
}

// DeleteScalingRule deletes a scaling rule by ID.
func DeleteScalingRule(id primitive.ObjectID) error {
	if mongoClient == nil || collection == nil {
		return fmt.Errorf("mongo not initialized")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	res, err := collection.DeleteOne(ctx, bson.M{"_id": id})
	if err != nil {
		return err
	}
	if res.DeletedCount == 0 {
		return ErrRuleNotFound
	}
	return nil
}

// UpdateScalingRuleStatus updates status fields for a rule (last action/value).
func UpdateScalingRuleStatus(id primitive.ObjectID, updates bson.M) error {
	if mongoClient == nil || collection == nil {
		return fmt.Errorf("mongo not initialized")
	}
	if len(updates) == 0 {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := collection.UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": updates})
	return err
}

func applyDefaults(rule *ScalingRule) {
	if rule.Operator == "" {
		rule.Operator = ">"
	}
	if rule.MinReplicas == 0 {
		rule.MinReplicas = 1
	}
	if rule.MaxReplicas == 0 {
		rule.MaxReplicas = 5
	}
	if rule.Step == 0 {
		rule.Step = 1
	}
}
