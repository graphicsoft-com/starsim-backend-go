package services

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"

	"starsim/db"
	"starsim/logger"

	"go.mongodb.org/mongo-driver/bson"
)

var (
	regMu     sync.RWMutex
	cachedIDs []string
)

// LoadRoomRegistry populates the in-memory room id cache from MongoDB.
func LoadRoomRegistry() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cur, err := db.Coll(db.CollRoomConfigs).Find(ctx, bson.M{}, nil)
	if err != nil {
		logger.Warn("[RoomRegistry] load failed: "+err.Error(), nil)
		return
	}
	defer cur.Close(ctx)
	var ids []string
	for cur.Next(ctx) {
		var d struct {
			RoomID string `bson:"roomId"`
		}
		if cur.Decode(&d) == nil && d.RoomID != "" {
			ids = append(ids, d.RoomID)
		}
	}
	sort.Strings(ids)
	regMu.Lock()
	cachedIDs = ids
	regMu.Unlock()
	logger.Info("[RoomRegistry] Loaded "+itoa(len(ids))+" rooms: "+strings.Join(ids, ", "), nil)
}

// GetRoomIDs returns the cached room ids.
func GetRoomIDs() []string {
	regMu.RLock()
	defer regMu.RUnlock()
	out := make([]string, len(cachedIDs))
	copy(out, cachedIDs)
	return out
}

// IsValidRoom reports whether a room id is known.
func IsValidRoom(roomID string) bool {
	regMu.RLock()
	defer regMu.RUnlock()
	for _, id := range cachedIDs {
		if id == roomID {
			return true
		}
	}
	return false
}

// AddRoomToRegistry adds a room id if absent and re-sorts.
func AddRoomToRegistry(roomID string) {
	regMu.Lock()
	defer regMu.Unlock()
	for _, id := range cachedIDs {
		if id == roomID {
			return
		}
	}
	cachedIDs = append(cachedIDs, roomID)
	sort.Strings(cachedIDs)
}

// RemoveRoomFromRegistry drops a room id from the cache.
func RemoveRoomFromRegistry(roomID string) {
	regMu.Lock()
	defer regMu.Unlock()
	out := cachedIDs[:0]
	for _, id := range cachedIDs {
		if id != roomID {
			out = append(out, id)
		}
	}
	cachedIDs = out
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
