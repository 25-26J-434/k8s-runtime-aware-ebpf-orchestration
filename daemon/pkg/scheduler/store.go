package scheduler

import (
	"context"
	"fmt"
	"log"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

var rulesColl *mongo.Collection

// InitStore must be called ONCE before Start/Run
func InitStore(mongoClient *mongo.Client) {
	if mongoClient == nil {
		log.Fatal("[Scheduler][Store] Mongo client is NIL")
	}

	// IMPORTANT: keep DB/collection names consistent with what you want
	// Use a separate collection for scheduling rules
	rulesColl = mongoClient.Database("rulesdb").Collection("scheduling_rules")
	log.Println("[Scheduler][Store] Mongo store initialized (rulesdb / scheduling_rules)")
}

func GetRules() ([]Rule, error) {
	if rulesColl == nil {
		return nil, fmt.Errorf("scheduler store not initialized: rulesColl is nil (did you call InitStore?)")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cur, err := rulesColl.Find(ctx, bson.M{"enabled": true})
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)

	var out []Rule
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}
