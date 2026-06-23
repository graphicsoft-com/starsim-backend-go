package services

import (
	"context"

	"starsim/db"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// SeedNoteTypesResult reports how many note types were inserted vs skipped.
type SeedNoteTypesResult struct {
	Inserted int
	Skipped  int
}

// SeedNoteTypes upserts the default note types (matched by name).
func SeedNoteTypes() SeedNoteTypesResult {
	ctx := context.Background()
	res := SeedNoteTypesResult{}
	for _, n := range defaultNoteTypes {
		count, _ := db.Coll(db.CollNoteTypeConfigs).CountDocuments(ctx, bson.M{"name": n.Name})
		if count > 0 {
			res.Skipped++
			continue
		}
		if _, err := db.Coll(db.CollNoteTypeConfigs).InsertOne(ctx, n); err == nil {
			res.Inserted++
		}
	}
	return res
}

// NextNoteOrder returns the next available order value.
func NextNoteOrder() int {
	ctx := context.Background()
	opts := options.FindOne().SetSort(bson.D{{Key: "order", Value: -1}})
	var doc struct {
		Order int `bson:"order"`
	}
	if err := db.Coll(db.CollNoteTypeConfigs).FindOne(ctx, bson.M{}, opts).Decode(&doc); err != nil {
		return 0
	}
	return doc.Order + 1
}
