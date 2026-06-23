package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Message mirrors the Mongoose Message schema (collection: messages).
// No timestamps and no version key in the original schema.
type Message struct {
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"_id,omitempty"`
	SessionID string             `bson:"sessionId" json:"sessionId"`
	RoomID    string             `bson:"roomId" json:"roomId"`
	Role      string             `bson:"role" json:"role"`
	Text      string             `bson:"text" json:"text"`
	Timestamp time.Time          `bson:"timestamp" json:"timestamp"`
}
