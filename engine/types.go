package engine

import (
	"time"

	"starsim/logger"
)

// Fields is a convenience alias for structured log fields.
type Fields = logger.Fields

// MsgPayload is the per-turn message handed to the socket layer (onMessage).
type MsgPayload struct {
	RoomID        string
	SessionID     string
	Role          string // clinician | patient
	Text          string
	Timestamp     time.Time
	TurnNumber    int
	SpeakerName   string
	SpeakerGender string
}

// PrefetchPayload is the speculative next-turn payload (onPrefetch).
type PrefetchPayload struct {
	RoomID        string
	Text          string
	TurnNumber    int
	SpeakerName   string
	SpeakerGender string
	Role          string
}

// Emitter is implemented by the websocket hub. It receives engine events.
type Emitter interface {
	EmitMessage(MsgPayload)
	EmitPrefetch(PrefetchPayload)
	EmitRoomUpdate(roomID, status string)
}

var emitter Emitter

// SetEmitter wires the websocket hub into the engine.
func SetEmitter(e Emitter) { emitter = e }

// EmitRoomUpdate broadcasts a room status change via the wired emitter.
func EmitRoomUpdate(roomID, status string) {
	if emitter != nil {
		emitter.EmitRoomUpdate(roomID, status)
	}
}

// Hooks into the services layer, set at startup to avoid import cycles.
var (
	HookAlertSessionStarted       func(roomID, sessionID string)
	HookAlertSessionStopped       func(roomID, sessionID string, startTime time.Time, turns int, reason string)
	HookRegisterEncounterWithNebo func(roomID, sessionID string)
	HookGetProvider               func(roomID string) string
)

func alertSessionStarted(roomID, sessionID string) {
	if HookAlertSessionStarted != nil {
		HookAlertSessionStarted(roomID, sessionID)
	}
}
func alertSessionStopped(roomID, sessionID string, st time.Time, turns int, reason string) {
	if HookAlertSessionStopped != nil {
		HookAlertSessionStopped(roomID, sessionID, st, turns, reason)
	}
}
func registerEncounterWithNebo(roomID, sessionID string) {
	if HookRegisterEncounterWithNebo != nil {
		HookRegisterEncounterWithNebo(roomID, sessionID)
	}
}
func getProvider(roomID string) string {
	if HookGetProvider != nil {
		return HookGetProvider(roomID)
	}
	return "webspeech"
}
