// Package ttsconfig holds the per-room TTS provider selection, broadcast to
// clients via the socket layer. Mirrors the Node TTSConfigStore.
package ttsconfig

import (
	"sync"
	"time"

	"starsim/config"
)

var validProviders = map[string]bool{
	"webspeech": true, "xtts": true, "vits": true, "piper": true, "disabled": true,
}

// RoomEntry is one room's provider override.
type RoomEntry struct {
	RoomID    string `json:"roomId"`
	Provider  string `json:"provider"`
	UpdatedAt string `json:"updatedAt"`
	UpdatedBy string `json:"updatedBy"`
}

// FullConfig is the snapshot shape the React client expects.
type FullConfig struct {
	Default string               `json:"default"`
	Version int                  `json:"version"`
	Rooms   map[string]RoomEntry `json:"rooms"`
}

type store struct {
	mu        sync.RWMutex
	def       string
	version   int
	rooms     map[string]RoomEntry
	broadcast func(FullConfig)
}

var s = &store{rooms: map[string]RoomEntry{}, version: 1}

// Init sets the default provider from the configured TTS mode.
func Init() {
	s.mu.Lock()
	defer s.mu.Unlock()
	def := config.C.TTSMode
	if !validProviders[def] {
		def = "xtts"
	}
	s.def = def
}

// SetBroadcast wires the socket broadcaster used after provider changes.
func SetBroadcast(fn func(FullConfig)) {
	s.mu.Lock()
	s.broadcast = fn
	s.mu.Unlock()
}

// GetProvider returns the effective provider for a room (override or default).
func GetProvider(roomID string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if r, ok := s.rooms[roomID]; ok && r.Provider != "" {
		return r.Provider
	}
	return s.def
}

// SetProvider applies a room override and bumps the version, returning an error
// string when the provider is invalid.
func SetProvider(roomID, provider, updatedBy string) (bool, string) {
	if !validProviders[provider] {
		return false, "Invalid provider: " + provider
	}
	s.mu.Lock()
	s.rooms[roomID] = RoomEntry{
		RoomID: roomID, Provider: provider,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339), UpdatedBy: updatedBy,
	}
	s.version++
	fc := s.fullLocked()
	bc := s.broadcast
	s.mu.Unlock()
	if bc != nil {
		bc(fc)
	}
	return true, ""
}

// GetFullConfig returns the current snapshot.
func GetFullConfig() FullConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.fullLocked()
}

func (st *store) fullLocked() FullConfig {
	rooms := make(map[string]RoomEntry, len(st.rooms))
	for k, v := range st.rooms {
		rooms[k] = v
	}
	return FullConfig{Default: st.def, Version: st.version, Rooms: rooms}
}

// RenameRoom moves an override from old to new room id.
func RenameRoom(oldID, newID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r, ok := s.rooms[oldID]; ok {
		r.RoomID = newID
		s.rooms[newID] = r
		delete(s.rooms, oldID)
	}
}
