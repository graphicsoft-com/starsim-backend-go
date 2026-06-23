// Package db owns the MongoDB client singleton and collection accessors.
package db

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

var (
	client   *mongo.Client
	database *mongo.Database
)

// Connect establishes the MongoDB connection and pings to verify it.
func Connect(ctx context.Context, uri, dbName string) error {
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	cl, err := mongo.Connect(cctx, options.Client().ApplyURI(uri))
	if err != nil {
		return err
	}
	if err := cl.Ping(cctx, nil); err != nil {
		return err
	}
	client = cl
	database = cl.Database(dbName)
	return nil
}

// DB returns the active database handle.
func DB() *mongo.Database { return database }

// Client returns the underlying mongo client.
func Client() *mongo.Client { return client }

// Coll returns a collection by name.
func Coll(name string) *mongo.Collection { return database.Collection(name) }

// Disconnect closes the client connection.
func Disconnect(ctx context.Context) error {
	if client == nil {
		return nil
	}
	c, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return client.Disconnect(c)
}

// Collection name constants — match the existing Mongoose-pluralized names.
const (
	CollSessions           = "sessions"
	CollRoomConfigs        = "roomconfigs"
	CollResidentProfiles   = "residentprofiles"
	CollSimulationDays     = "simulationdays"
	CollResidentEncounters = "residentencounters"
	CollMessages           = "messages"
	CollCharacters         = "characters"
	CollNoteTypeConfigs    = "notetypeconfigs"
	CollSystemSettings     = "systemsettings"
)
