package handlers

import (
	"context"
	"net/http"
	"strings"
	"time"

	"starsim/db"
	"starsim/models"
	"starsim/services"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// GetCharacters handles GET /api/characters?role=.
func GetCharacters(c *gin.Context) {
	role := c.Query("role")
	var chars []models.Character
	var err error
	if role == "clinician" || role == "patient" {
		chars, err = services.GetCharactersByRole(role)
	} else {
		chars, err = services.GetAllCharacters()
	}
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, chars)
}

// CreateCharacter handles POST /api/characters.
func CreateCharacter(c *gin.Context) {
	var body struct {
		Name    string `json:"name"`
		Role    string `json:"role"`
		Gender  string `json:"gender"`
		Age     *int   `json:"age"`
		Email   string `json:"email"`
		Profile string `json:"profile"`
		Prompt  string `json:"prompt"`
	}
	_ = c.ShouldBindJSON(&body)
	if body.Name == "" || body.Role == "" || body.Gender == "" || body.Profile == "" || body.Prompt == "" {
		fail(c, http.StatusBadRequest, "Missing required fields")
		return
	}
	ch := models.Character{
		Name: body.Name, Role: body.Role, Gender: body.Gender, Age: body.Age,
		Email: body.Email, Profile: body.Profile, Prompt: body.Prompt,
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	res, err := db.Coll(db.CollCharacters).InsertOne(context.Background(), ch)
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "duplicate key") {
			status = http.StatusConflict
		}
		fail(c, status, err.Error())
		return
	}
	ch.ID = res.InsertedID.(primitive.ObjectID)
	okStatus(c, http.StatusCreated, ch)
}

// UpdateCharacter handles PUT /api/characters/:id.
func UpdateCharacter(c *gin.Context) {
	oid, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		fail(c, http.StatusNotFound, "Character not found")
		return
	}
	var body map[string]interface{}
	_ = c.ShouldBindJSON(&body)
	delete(body, "_id")
	body["updatedAt"] = time.Now()
	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var ch models.Character
	if db.Coll(db.CollCharacters).FindOneAndUpdate(context.Background(), bson.M{"_id": oid},
		bson.M{"$set": body}, opts).Decode(&ch) != nil {
		fail(c, http.StatusNotFound, "Character not found")
		return
	}
	ok(c, ch)
}

// DeleteCharacter handles DELETE /api/characters/:id.
func DeleteCharacter(c *gin.Context) {
	oid, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		fail(c, http.StatusNotFound, "Character not found")
		return
	}
	res, err := db.Coll(db.CollCharacters).DeleteOne(context.Background(), bson.M{"_id": oid})
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if res.DeletedCount == 0 {
		fail(c, http.StatusNotFound, "Character not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
