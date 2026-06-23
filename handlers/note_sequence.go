package handlers

import (
	"context"
	"net/http"
	"time"

	"starsim/db"
	"starsim/models"
	"starsim/services"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// ListNoteTypes handles GET /api/note-sequence.
func ListNoteTypes(c *gin.Context) {
	ctx := context.Background()
	cur, err := db.Coll(db.CollNoteTypeConfigs).Find(ctx, bson.M{},
		options.Find().SetSort(bson.D{{Key: "order", Value: 1}}))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	notes := []models.NoteTypeConfig{}
	_ = cur.All(ctx, &notes)
	ok(c, notes)
}

// SeedNoteTypes handles POST /api/note-sequence/seed.
func SeedNoteTypes(c *gin.Context) {
	res := services.SeedNoteTypes()
	ctx := context.Background()
	cur, _ := db.Coll(db.CollNoteTypeConfigs).Find(ctx, bson.M{},
		options.Find().SetSort(bson.D{{Key: "order", Value: 1}}))
	notes := []models.NoteTypeConfig{}
	_ = cur.All(ctx, &notes)
	ok(c, gin.H{"inserted": res.Inserted, "skipped": res.Skipped, "notes": notes})
}

// ReorderNoteTypes handles PUT /api/note-sequence/reorder.
func ReorderNoteTypes(c *gin.Context) {
	var body struct {
		Order []struct {
			ID    string `json:"_id"`
			Order int    `json:"order"`
		} `json:"order"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, http.StatusBadRequest, "order must be an array")
		return
	}
	ctx := context.Background()
	for idx, o := range body.Order {
		if oid, err := primitive.ObjectIDFromHex(o.ID); err == nil {
			_, _ = db.Coll(db.CollNoteTypeConfigs).UpdateByID(ctx, oid, bson.M{"$set": bson.M{"order": idx}})
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// UpdateNoteType handles PUT /api/note-sequence/:id.
func UpdateNoteType(c *gin.Context) {
	oid, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		fail(c, http.StatusNotFound, "Note type not found")
		return
	}
	var body map[string]interface{}
	_ = c.ShouldBindJSON(&body)
	delete(body, "_id")
	body["updatedAt"] = time.Now()
	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var doc models.NoteTypeConfig
	if db.Coll(db.CollNoteTypeConfigs).FindOneAndUpdate(context.Background(), bson.M{"_id": oid},
		bson.M{"$set": body}, opts).Decode(&doc) != nil {
		fail(c, http.StatusNotFound, "Note type not found")
		return
	}
	ok(c, doc)
}

// DeleteNoteType handles DELETE /api/note-sequence/:id.
func DeleteNoteType(c *gin.Context) {
	oid, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		fail(c, http.StatusInternalServerError, "invalid id")
		return
	}
	_, _ = db.Coll(db.CollNoteTypeConfigs).DeleteOne(context.Background(), bson.M{"_id": oid})
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// CreateNoteType handles POST /api/note-sequence.
func CreateNoteType(c *gin.Context) {
	var body struct {
		Name              string `json:"name"`
		DayType           string `json:"dayType"`
		RequiresHistory   bool   `json:"requiresHistory"`
		HistoryLimit      *int   `json:"historyLimit"`
		NeboFormID        int    `json:"neboFormId"`
		NotePrompt        string `json:"notePrompt"`
		PatientNotePrompt string `json:"patientNotePrompt"`
	}
	_ = c.ShouldBindJSON(&body)
	if body.Name == "" {
		fail(c, http.StatusBadRequest, "name is required")
		return
	}
	dayType := body.DayType
	if dayType == "" {
		dayType = "both"
	}
	historyLimit := 3
	if body.HistoryLimit != nil {
		historyLimit = *body.HistoryLimit
	}
	doc := models.NoteTypeConfig{
		Name: body.Name, DayType: dayType, Order: services.NextNoteOrder(),
		RequiresHistory: body.RequiresHistory, HistoryLimit: historyLimit, NeboFormID: body.NeboFormID,
		NotePrompt: body.NotePrompt, PatientNotePrompt: body.PatientNotePrompt, Enabled: true,
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	res, err := db.Coll(db.CollNoteTypeConfigs).InsertOne(context.Background(), doc)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	doc.ID = res.InsertedID.(primitive.ObjectID)
	okStatus(c, http.StatusCreated, doc)
}
