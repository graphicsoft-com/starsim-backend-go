package services

import (
	"context"

	"starsim/db"
	"starsim/logger"
	"starsim/models"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// SeedCharacters idempotently inserts the default characters (matched by name+role).
func SeedCharacters() {
	ctx := context.Background()
	for _, c := range defaultCharacters {
		count, _ := db.Coll(db.CollCharacters).CountDocuments(ctx, bson.M{"name": c.Name, "role": c.Role})
		if count > 0 {
			continue
		}
		if _, err := db.Coll(db.CollCharacters).InsertOne(ctx, c); err == nil {
			logger.Info("[Character] Seeded "+c.Role+": "+c.Name, nil)
		}
	}
}

// GetAllCharacters returns all characters sorted by role then name.
func GetAllCharacters() ([]models.Character, error) {
	ctx := context.Background()
	cur, err := db.Coll(db.CollCharacters).Find(ctx, bson.M{},
		options.Find().SetSort(bson.D{{Key: "role", Value: 1}, {Key: "name", Value: 1}}))
	if err != nil {
		return nil, err
	}
	out := []models.Character{}
	err = cur.All(ctx, &out)
	return out, err
}

// GetCharactersByRole returns characters for a role sorted by name.
func GetCharactersByRole(role string) ([]models.Character, error) {
	ctx := context.Background()
	cur, err := db.Coll(db.CollCharacters).Find(ctx, bson.M{"role": role},
		options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		return nil, err
	}
	out := []models.Character{}
	err = cur.All(ctx, &out)
	return out, err
}
