package services

import (
	"context"
	"fmt"
	"time"

	"starsim/db"
	"starsim/engine"
	"starsim/logger"
	"starsim/models"
	"starsim/ttsconfig"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func defaultRoomByID(roomID string) *models.RoomConfig {
	for i := range defaultRoomConfigs {
		if defaultRoomConfigs[i].RoomID == roomID {
			c := defaultRoomConfigs[i]
			return &c
		}
	}
	return nil
}

// GetRoomConfig returns a room config, seeding defaults on miss when known.
func GetRoomConfig(roomID string) (*models.RoomConfig, error) {
	ctx := context.Background()
	var rc models.RoomConfig
	err := db.Coll(db.CollRoomConfigs).FindOne(ctx, bson.M{"roomId": roomID}).Decode(&rc)
	if err == nil {
		return &rc, nil
	}
	if def := defaultRoomByID(roomID); def != nil {
		logger.Info("[RoomConfig] No config found for "+roomID+" — seeding defaults", nil)
		def.UpdatedAt = time.Now()
		if _, e := db.Coll(db.CollRoomConfigs).InsertOne(ctx, def); e != nil {
			return nil, e
		}
		return def, nil
	}
	return nil, fmt.Errorf("No config found for %s", roomID)
}

// GetAllRoomConfigs returns every room config sorted by roomId.
func GetAllRoomConfigs() ([]models.RoomConfig, error) {
	ctx := context.Background()
	cur, err := db.Coll(db.CollRoomConfigs).Find(ctx, bson.M{}, options.Find().SetSort(bson.D{{Key: "roomId", Value: 1}}))
	if err != nil {
		return nil, err
	}
	out := []models.RoomConfig{}
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// UpdateRoomConfig upserts the given fields and stamps updatedAt/updatedBy.
func UpdateRoomConfig(roomID string, updates bson.M, updatedBy string) (*models.RoomConfig, error) {
	if updatedBy == "" {
		updatedBy = "dashboard"
	}
	updates["updatedAt"] = time.Now()
	updates["updatedBy"] = updatedBy
	ctx := context.Background()
	opts := options.FindOneAndUpdate().SetUpsert(true).SetReturnDocument(options.After)
	var rc models.RoomConfig
	err := db.Coll(db.CollRoomConfigs).FindOneAndUpdate(ctx, bson.M{"roomId": roomID}, bson.M{"$set": updates}, opts).Decode(&rc)
	if err != nil {
		return nil, err
	}
	logger.Info("[RoomConfig] "+roomID+" updated by "+updatedBy, nil)
	return &rc, nil
}

// RenameRoomConfig changes a room's id, updating the registry and TTS store.
func RenameRoomConfig(oldID, newID, updatedBy string) (*models.RoomConfig, error) {
	if updatedBy == "" {
		updatedBy = "dashboard"
	}
	if engine.GetRoomStatus(oldID) {
		return nil, fmt.Errorf("Cannot rename room \"%s\" while a session is active.", oldID)
	}
	ctx := context.Background()
	count, _ := db.Coll(db.CollRoomConfigs).CountDocuments(ctx, bson.M{"roomId": newID})
	if count > 0 {
		return nil, fmt.Errorf("Room ID \"%s\" is already in use.", newID)
	}
	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var rc models.RoomConfig
	err := db.Coll(db.CollRoomConfigs).FindOneAndUpdate(ctx, bson.M{"roomId": oldID},
		bson.M{"$set": bson.M{"roomId": newID, "updatedAt": time.Now(), "updatedBy": updatedBy}}, opts).Decode(&rc)
	if err != nil {
		return nil, err
	}
	RemoveRoomFromRegistry(oldID)
	AddRoomToRegistry(newID)
	ttsconfig.RenameRoom(oldID, newID)
	logger.Info("[RoomConfig] renamed "+oldID+" → "+newID, nil)
	return &rc, nil
}

// DeleteRoomConfig removes a room config and drops it from the registry.
func DeleteRoomConfig(roomID string) error {
	ctx := context.Background()
	res, err := db.Coll(db.CollRoomConfigs).DeleteOne(ctx, bson.M{"roomId": roomID})
	if err != nil {
		return err
	}
	if res.DeletedCount == 0 {
		return fmt.Errorf("No config found for %s", roomID)
	}
	RemoveRoomFromRegistry(roomID)
	logger.Info("[RoomConfig] deleted "+roomID, nil)
	return nil
}

// CreateRoomConfig creates a blank room config and registers it.
func CreateRoomConfig(roomID, createdBy string) (*models.RoomConfig, error) {
	if createdBy == "" {
		createdBy = "dashboard"
	}
	ctx := context.Background()
	count, _ := db.Coll(db.CollRoomConfigs).CountDocuments(ctx, bson.M{"roomId": roomID})
	if count > 0 {
		return nil, fmt.Errorf("Room ID \"%s\" already exists.", roomID)
	}
	rc := models.RoomConfig{
		RoomID:          roomID,
		CaregiverGender: "female",
		PatientGender:   "male",
		PatientAge:      75,
		TTSProvider:     "webspeech",
		NeboFormID:      1,
		UpdatedAt:       time.Now(),
		UpdatedBy:       createdBy,
	}
	if _, err := db.Coll(db.CollRoomConfigs).InsertOne(ctx, rc); err != nil {
		return nil, err
	}
	AddRoomToRegistry(roomID)
	logger.Info("[RoomConfig] created "+roomID+" by "+createdBy, nil)
	return &rc, nil
}

// SeedRoomConfigs inserts the default room configs when the collection is empty.
func SeedRoomConfigs() {
	ctx := context.Background()
	count, _ := db.Coll(db.CollRoomConfigs).CountDocuments(ctx, bson.M{})
	if count > 0 {
		logger.Info(fmt.Sprintf("%d room configs already exist — skipping seed", count), nil)
		return
	}
	for i := range defaultRoomConfigs {
		rc := defaultRoomConfigs[i]
		rc.UpdatedAt = time.Now()
		if rc.NeboFormID == 0 {
			rc.NeboFormID = 1
		}
		if _, err := db.Coll(db.CollRoomConfigs).InsertOne(ctx, rc); err != nil && err != mongo.ErrNoDocuments {
			logger.Warn("[RoomConfig] seed failed for "+rc.RoomID+": "+err.Error(), nil)
			continue
		}
		logger.Info("[RoomConfig] seeded "+rc.RoomID, nil)
	}
}
