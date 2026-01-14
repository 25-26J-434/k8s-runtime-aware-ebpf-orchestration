package redirection

import (
	"context"
	"errors"
	"log"
	"os"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// Store wraps MongoDB access for routing policies.
type Store struct {
	client *mongo.Client
	coll   *mongo.Collection
}

// ErrNotFound is returned when a policy cannot be located.
var ErrNotFound = errors.New("policy not found")

// InitStore connects to MongoDB and prepares indexes.
func InitStore(ctx context.Context) (*Store, error) {
	uri := firstNonEmpty(
		os.Getenv("ROUTING_MONGO_URI"),
		os.Getenv("MONGODB_URI"),
		"mongodb://mongodb.test-services.svc.cluster.local:27017/component2?directConnection=true",
	)

	dbName := firstNonEmpty(os.Getenv("ROUTING_MONGO_DB"), "component2")
	collName := firstNonEmpty(os.Getenv("ROUTING_MONGO_COLLECTION"), "policies")

	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		return nil, err
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx, nil); err != nil {
		return nil, err
	}

	coll := client.Database(dbName).Collection(collName)

	// Ensure unique policy_name index
	_, err = coll.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "policy_name", Value: 1}},
		Options: options.Index().SetUnique(true),
	})
	if err != nil {
		log.Printf("[RoutingStore] failed to create index: %v", err)
	}

	log.Printf("[RoutingStore] Connected to %s (db=%s collection=%s)", uri, dbName, collName)
	return &Store{client: client, coll: coll}, nil
}

// List returns all policies sorted by updatedAt descending.
func (s *Store) List(ctx context.Context) ([]Policy, error) {
	opts := options.Find().SetSort(bson.D{{Key: "updatedAt", Value: -1}})
	cur, err := s.coll.Find(ctx, bson.M{}, opts)
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)

	var results []Policy
	if err := cur.All(ctx, &results); err != nil {
		return nil, err
	}
	return results, nil
}

// GetByName fetches a policy using its unique policy_name.
func (s *Store) GetByName(ctx context.Context, name string) (*Policy, error) {
	var p Policy
	err := s.coll.FindOne(ctx, bson.M{"policy_name": name}).Decode(&p)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// Insert creates a new policy document.
func (s *Store) Insert(ctx context.Context, p *Policy) (*Policy, error) {
	now := time.Now().UTC()
	p.CreatedAt = now
	p.UpdatedAt = now

	res, err := s.coll.InsertOne(ctx, p)
	if mongo.IsDuplicateKeyError(err) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}

	if oid, ok := res.InsertedID.(primitive.ObjectID); ok {
		p.ID = oid
	}
	return p, nil
}

// Replace overwrites an existing policy (matched by _id).
func (s *Store) Replace(ctx context.Context, p *Policy) error {
	if p.ID.IsZero() {
		return errors.New("policy missing _id")
	}
	p.UpdatedAt = time.Now().UTC()
	_, err := s.coll.ReplaceOne(ctx, bson.M{"_id": p.ID}, p)
	return err
}

// Delete removes a policy by name.
func (s *Store) Delete(ctx context.Context, name string) error {
	_, err := s.coll.DeleteOne(ctx, bson.M{"policy_name": name})
	return err
}

// firstNonEmpty returns the first non-empty string.
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
