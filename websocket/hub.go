// Package wsx implements the Socket.IO-compatible realtime layer. It speaks the
// Socket.IO v4 protocol so the unchanged React client connects without changes.
package wsx

import (
	"net/http"
	"sync"
	"time"

	"starsim/engine"
	"starsim/logger"
	"starsim/ttsconfig"

	"github.com/zishang520/engine.io/v2/types"
	"github.com/zishang520/socket.io/v2/socket"
)

// Hub owns the Socket.IO server and all room / Oid registries.
type Hub struct {
	io *socket.Server

	mu sync.RWMutex
	// oidRegistry: roomId -> role -> set of socketIds
	oidRegistry map[string]map[string]map[string]bool
	// roomOwners: roomId -> socketId (authoritative TTS owner)
	roomOwners map[string]string
	// sockets: socketId -> live socket for direct emits
	sockets map[string]*socket.Socket
	// pendingMessages: roomId -> buffered new_message payloads
	pendingMessages map[string][]map[string]interface{}
	// uploadedRoles: roomId -> sessionId -> set of roles
	uploadedRoles map[string]map[string]map[string]bool
}

// NewHub constructs the hub and its underlying Socket.IO server (CORS: *).
func NewHub() *Hub {
	opts := socket.DefaultServerOptions()
	opts.SetCors(&types.Cors{Origin: "*", Methods: []string{"GET", "POST"}})
	opts.SetPingInterval(25 * time.Second)
	opts.SetPingTimeout(60 * time.Second)
	io := socket.NewServer(nil, opts)

	h := &Hub{
		io:              io,
		oidRegistry:     map[string]map[string]map[string]bool{},
		roomOwners:      map[string]string{},
		sockets:         map[string]*socket.Socket{},
		pendingMessages: map[string][]map[string]interface{}{},
		uploadedRoles:   map[string]map[string]map[string]bool{},
	}
	h.register()

	ttsconfig.SetBroadcast(func(fc ttsconfig.FullConfig) {
		h.io.Emit("tts_config_updated", map[string]interface{}{
			"roomId":     "all",
			"provider":   fc.Default,
			"fullConfig": fc,
			"version":    fc.Version,
			"timestamp":  nowISO(),
		})
	})
	return h
}

// Handler returns the http.Handler serving the /socket.io/ endpoint.
func (h *Hub) Handler() http.Handler {
	return h.io.ServeHandler(nil)
}

// Server exposes the underlying socket.io server.
func (h *Hub) Server() *socket.Server { return h.io }

func nowISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z07:00")
}

// ---- direct emit helpers ----

func (h *Hub) directEmit(socketID, event string, payload interface{}) {
	h.mu.RLock()
	s := h.sockets[socketID]
	h.mu.RUnlock()
	if s != nil {
		_ = s.Emit(event, payload)
	}
}

// getOidSocketIDs returns all socket ids registered for a role in a room.
func (h *Hub) getOidSocketIDs(roomID, role string) []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	var out []string
	if roles, ok := h.oidRegistry[roomID]; ok {
		for id := range roles[role] {
			out = append(out, id)
		}
	}
	return out
}

func (h *Hub) getOidRoomSocketIDs(roomID string) []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	var out []string
	for _, set := range h.oidRegistry[roomID] {
		for id := range set {
			out = append(out, id)
		}
	}
	return out
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func (h *Hub) buildParticipantStatus(roomID string) map[string]interface{} {
	h.mu.RLock()
	defer h.mu.RUnlock()
	res := map[string]interface{}{}
	for role, set := range h.oidRegistry[roomID] {
		res[role] = map[string]bool{"connected": len(set) > 0}
	}
	return res
}

func (h *Hub) emitOidStatusUpdate(roomID string) {
	payload := map[string]interface{}{"roomId": roomID, "participants": h.buildParticipantStatus(roomID)}
	h.io.To(socket.Room("dashboard")).Emit("oid_status_update", payload)
	h.io.To(socket.Room(roomID)).Emit("oid_status_update", payload)
}

// ---- engine.Emitter implementation ----

// EmitMessage routes a per-turn message to Oid machines, dashboards, and any
// fallback buffer — mirroring the Node emitToOidOrFallback logic.
func (h *Hub) EmitMessage(p engine.MsgPayload) {
	oidRole := p.Role // clinician/patient map 1:1
	ts := p.Timestamp.UTC().Format("2006-01-02T15:04:05.000Z07:00")
	full := map[string]interface{}{
		"roomId":        p.RoomID,
		"sessionId":     p.SessionID,
		"role":          oidRole,
		"text":          p.Text,
		"timestamp":     ts,
		"turnNumber":    p.TurnNumber,
		"speakerName":   p.SpeakerName,
		"speakerGender": p.SpeakerGender,
	}

	speakerSockets := h.getOidSocketIDs(p.RoomID, oidRole)
	if len(speakerSockets) > 0 {
		for _, sid := range speakerSockets {
			h.directEmit(sid, "speak_now", full)
		}
		// wait_turn to every other room socket
		for _, sid := range h.getOidRoomSocketIDs(p.RoomID) {
			if !contains(speakerSockets, sid) {
				h.directEmit(sid, "wait_turn", map[string]interface{}{"roomId": p.RoomID, "activeRole": oidRole})
			}
		}
		// chat_message to all room sockets
		for _, sid := range h.getOidRoomSocketIDs(p.RoomID) {
			h.directEmit(sid, "chat_message", map[string]interface{}{
				"roomId": p.RoomID, "role": oidRole, "text": p.Text,
				"speakerName": p.SpeakerName, "timestamp": ts,
			})
		}
	} else {
		// Legacy fallback / buffering for plain room tabs
		h.mu.Lock()
		hasClients := h.roomHasClientsLocked(p.RoomID)
		if hasClients {
			if buf := h.pendingMessages[p.RoomID]; len(buf) > 0 {
				logger.RoomLog(p.RoomID, "info", "Flushing "+itoa(len(buf))+" buffered message(s) to room", nil)
				for _, m := range buf {
					h.io.To(socket.Room(p.RoomID)).Emit("new_message", m)
				}
				h.pendingMessages[p.RoomID] = nil
			}
			h.mu.Unlock()
			h.io.To(socket.Room(p.RoomID)).Emit("new_message", full)
		} else {
			h.pendingMessages[p.RoomID] = append(h.pendingMessages[p.RoomID], full)
			h.mu.Unlock()
			logger.RoomLog(p.RoomID, "info", "Buffered message (no clients yet) — "+p.Role+" turn", nil)
		}
	}

	// Always: dashboard watchers + room_update
	h.io.To(socket.Room("dashboard")).Emit("new_message", full)
	h.io.Emit("room_update", map[string]interface{}{"roomId": p.RoomID, "status": "active"})
}

func (h *Hub) roomHasClientsLocked(roomID string) bool {
	for _, set := range h.oidRegistry[roomID] {
		if len(set) > 0 {
			return true
		}
	}
	if h.roomOwners[roomID] != "" {
		return true
	}
	return false
}

// EmitPrefetch sends the speculative next-turn payload to the next speaker.
func (h *Hub) EmitPrefetch(p engine.PrefetchPayload) {
	payload := map[string]interface{}{
		"roomId": p.RoomID, "text": p.Text, "turnNumber": p.TurnNumber,
		"speakerName": p.SpeakerName, "speakerGender": p.SpeakerGender,
	}
	for _, sid := range h.getOidSocketIDs(p.RoomID, p.Role) {
		h.directEmit(sid, "prefetch_audio", payload)
	}
}

// EmitRoomUpdate broadcasts a room status change.
func (h *Hub) EmitRoomUpdate(roomID, status string) {
	h.io.Emit("room_update", map[string]interface{}{"roomId": roomID, "status": status})
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
