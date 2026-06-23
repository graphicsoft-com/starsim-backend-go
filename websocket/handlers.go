package wsx

import (
	"strings"

	"starsim/engine"
	"starsim/logger"
	"starsim/services"
	"starsim/ttsconfig"

	"github.com/zishang520/socket.io/v2/socket"
)

type clientData struct {
	roomID string
	role   string
}

func asMap(args []any) map[string]interface{} {
	if len(args) > 0 {
		if m, ok := args[0].(map[string]interface{}); ok {
			return m
		}
	}
	return nil
}

func mstr(m map[string]interface{}, k string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[k].(string); ok {
		return v
	}
	return ""
}

func mnum(m map[string]interface{}, k string) (int, bool) {
	if m == nil {
		return 0, false
	}
	switch v := m[k].(type) {
	case float64:
		return int(v), true
	case int:
		return v, true
	}
	return 0, false
}

func (h *Hub) register() {
	h.io.On("connection", func(clients ...any) {
		s := clients[0].(*socket.Socket)
		id := string(s.Id())
		s.SetData(&clientData{})

		h.mu.Lock()
		h.sockets[id] = s
		h.mu.Unlock()
		logger.WsLog("Client connected: "+id, "info")

		s.On("join_room", func(args ...any) { h.onJoinRoom(s, args) })
		s.On("join_dashboard", func(args ...any) { h.onJoinDashboard(s) })
		s.On("register_oid", func(args ...any) { h.onRegisterOid(s, args) })
		s.On("room_tts_state", func(args ...any) {
			if len(args) > 0 {
				h.io.To(socket.Room("dashboard")).Emit("room_tts_state", args[0])
			}
		})
		s.On("tts_done", func(args ...any) { h.onTTSDone(s, args) })
		s.On("voice_ready", func(args ...any) { h.onVoiceReady(s, args) })
		s.On("tts_error", func(args ...any) { h.onTTSError(args) })
		s.On("tts_config_change", func(args ...any) { h.onTTSConfigChange(s, args) })
		s.On("tts_config_request", func(args ...any) { h.onTTSConfigRequest(s) })
		s.On("get_oid_status", func(args ...any) { h.onGetOidStatus(s) })
		s.On("turns_uploaded", func(args ...any) { h.onTurnsUploaded(args) })
		s.On("upload_failed", func(args ...any) { h.onUploadFailed(args) })
		s.On("disconnect", func(args ...any) { h.onDisconnect(s) })
	})
}

func (h *Hub) onJoinRoom(s *socket.Socket, args []any) {
	roomID, _ := args[0].(string)
	if !services.IsValidRoom(roomID) {
		_ = s.Emit("error", map[string]interface{}{"message": "Invalid roomId: " + roomID})
		return
	}
	id := string(s.Id())
	h.mu.Lock()
	if owner, ok := h.roomOwners[roomID]; ok && owner != id {
		h.mu.Unlock()
		logger.WsLog("["+roomID+"] Blocked — already owned by "+owner, "warn")
		_ = s.Emit("room_locked", map[string]interface{}{"roomId": roomID, "message": "Room " + roomID + " is currently in use. Please try again later."})
		return
	}
	for _, rid := range services.GetRoomIDs() {
		if h.roomOwners[rid] == id {
			delete(h.roomOwners, rid)
		}
		s.Leave(socket.Room(rid))
	}
	s.Join(socket.Room(roomID))
	h.roomOwners[roomID] = id
	buf := h.pendingMessages[roomID]
	h.pendingMessages[roomID] = nil
	h.mu.Unlock()

	logger.WsLog("Socket "+id+" joined "+roomID+" (owner)", "info")
	_ = s.Emit("joined_room", map[string]interface{}{"roomId": roomID})
	if len(buf) > 0 {
		logger.RoomLog(roomID, "info", "Flushing "+itoa(len(buf))+" buffered message(s) to new owner", nil)
		for _, m := range buf {
			_ = s.Emit("new_message", m)
		}
	}
}

func (h *Hub) onJoinDashboard(s *socket.Socket) {
	s.Join(socket.Room("dashboard"))
	for _, rid := range services.GetRoomIDs() {
		s.Join(socket.Room(rid))
	}
	logger.WsLog("Socket "+string(s.Id())+" joined dashboard (all rooms, no ownership)", "info")
	_ = s.Emit("joined_dashboard")
}

func (h *Hub) onRegisterOid(s *socket.Socket, args []any) {
	m := asMap(args)
	roomID := strings.ToLower(mstr(m, "roomId"))
	role := mstr(m, "role")
	if roomID == "" || role == "" {
		return
	}
	id := string(s.Id())
	h.mu.Lock()
	if h.oidRegistry[roomID] == nil {
		h.oidRegistry[roomID] = map[string]map[string]bool{}
	}
	if h.oidRegistry[roomID][role] == nil {
		h.oidRegistry[roomID][role] = map[string]bool{}
	}
	h.oidRegistry[roomID][role][id] = true
	total := len(h.oidRegistry[roomID][role])
	h.mu.Unlock()

	s.Join(socket.Room(roomID))
	if cd, ok := s.Data().(*clientData); ok {
		cd.roomID = roomID
		cd.role = role
	}
	logger.WsLog("[OID REGISTERED] room="+roomID+" role="+role+" socket="+id+" total="+itoa(total), "info")
	h.emitOidStatusUpdate(roomID)
	h.io.Emit("oid_connected", map[string]interface{}{"roomId": roomID, "role": role})
}

func (h *Hub) onTTSDone(s *socket.Socket, args []any) {
	m := asMap(args)
	roomID := strings.ToLower(mstr(m, "roomId"))
	role := mstr(m, "role")
	turn, ok := mnum(m, "turnNumber")
	if roomID == "" || !services.IsValidRoom(roomID) || role == "" || !ok {
		return
	}
	id := string(s.Id())
	h.mu.RLock()
	registered := h.oidRegistry[roomID] != nil && h.oidRegistry[roomID][role] != nil && h.oidRegistry[roomID][role][id]
	h.mu.RUnlock()
	if !registered {
		logger.WsLog("["+roomID+"] tts_done ignored — sender "+id+" is not registered for role "+role, "warn")
		return
	}
	if expected, has := engine.GetTTSExpectedTurn(roomID); has && turn < expected {
		logger.WsLog("["+roomID+"] stale tts_done from behind client — sending catch_up", "warn")
		_ = s.Emit("catch_up", map[string]interface{}{"roomId": roomID, "currentTurn": expected})
		return
	}
	engine.AcknowledgeTTS(roomID, turn, role)
}

func (h *Hub) onVoiceReady(s *socket.Socket, args []any) {
	m := asMap(args)
	roomID := strings.ToLower(mstr(m, "roomId"))
	if roomID == "" || !services.IsValidRoom(roomID) {
		return
	}
	role := ""
	if cd, ok := s.Data().(*clientData); ok {
		role = cd.role
	}
	if role == "" {
		logger.WsLog("["+roomID+"] voice_ready ignored — no role registered", "warn")
		return
	}
	logger.WsLog("["+roomID+"] voice_ready received from "+string(s.Id())+" (role="+role+")", "info")
	engine.AcknowledgeVoiceReady(roomID, role)
}

func (h *Hub) onTTSError(args []any) {
	m := asMap(args)
	roomID := strings.ToLower(mstr(m, "roomId"))
	if roomID == "" || !services.IsValidRoom(roomID) {
		return
	}
	role := mstr(m, "role")
	errMsg := mstr(m, "error")
	logger.WsLog("["+roomID+"] TTS error: "+errMsg, "warn")
	services.AlertTTSError(roomID, role, errMsg)
}

func (h *Hub) onTTSConfigChange(s *socket.Socket, args []any) {
	m := asMap(args)
	roomID := mstr(m, "roomId")
	provider := mstr(m, "provider")
	ok, errStr := ttsconfig.SetProvider(roomID, provider, "operator")
	if !ok {
		_ = s.Emit("tts_config_error", map[string]interface{}{"roomId": roomID, "error": errStr})
		logger.WsLog("Config change rejected — room="+roomID+" provider="+provider+" error="+errStr, "warn")
	}
}

func (h *Hub) onTTSConfigRequest(s *socket.Socket) {
	cfg := ttsconfig.GetFullConfig()
	_ = s.Emit("tts_config_updated", map[string]interface{}{
		"roomId": "all", "provider": cfg.Default, "fullConfig": cfg,
		"version": cfg.Version, "timestamp": nowISO(),
	})
}

func (h *Hub) onGetOidStatus(s *socket.Socket) {
	snapshot := map[string]interface{}{}
	h.mu.RLock()
	for _, roomID := range services.GetRoomIDs() {
		clin := h.oidRegistry[roomID] != nil && len(h.oidRegistry[roomID]["clinician"]) > 0
		pat := h.oidRegistry[roomID] != nil && len(h.oidRegistry[roomID]["patient"]) > 0
		snapshot[roomID] = map[string]bool{"clinician": clin, "patient": pat}
	}
	h.mu.RUnlock()
	_ = s.Emit("oid_status_snapshot", snapshot)
}

func (h *Hub) onTurnsUploaded(args []any) {
	m := asMap(args)
	roomID := strings.ToLower(mstr(m, "roomId"))
	sessionID := mstr(m, "sessionId")
	role := mstr(m, "role")
	if roomID == "" || sessionID == "" || role == "" {
		return
	}
	h.mu.Lock()
	if h.uploadedRoles[roomID] == nil {
		h.uploadedRoles[roomID] = map[string]map[string]bool{}
	}
	if h.uploadedRoles[roomID][sessionID] == nil {
		h.uploadedRoles[roomID][sessionID] = map[string]bool{}
	}
	h.uploadedRoles[roomID][sessionID][role] = true
	both := h.uploadedRoles[roomID][sessionID]["clinician"] && h.uploadedRoles[roomID][sessionID]["patient"]
	if both {
		delete(h.uploadedRoles[roomID], sessionID)
	}
	h.mu.Unlock()

	logger.WsLog("["+roomID+"] turns_uploaded — role="+role+" sessionId="+sessionID, "info")
	if !both {
		return
	}
	go func() {
		res, err := services.MergeSessionAudio(roomID, sessionID, 2500)
		if err != nil {
			logger.WsLog("["+roomID+"] Merge failed: "+err.Error(), "warn")
			h.io.To(socket.Room(roomID)).Emit("session_merge_failed", map[string]interface{}{
				"roomId": roomID, "sessionId": sessionID, "error": err.Error()})
			return
		}
		h.io.To(socket.Room(roomID)).Emit("session_merged", map[string]interface{}{
			"roomId": roomID, "sessionId": sessionID, "key": res.Key, "url": res.URL,
			"turnCount": res.TurnCount, "sizeMb": res.SizeMb})
	}()
}

func (h *Hub) onUploadFailed(args []any) {
	m := asMap(args)
	roomID := strings.ToLower(mstr(m, "roomId"))
	sessionID := mstr(m, "sessionId")
	if roomID == "" || sessionID == "" {
		return
	}
	logger.WsLog("["+roomID+"] upload_failed reported by client — sessionId="+sessionID, "info")
}

func (h *Hub) onDisconnect(s *socket.Socket) {
	id := string(s.Id())
	var roomID, role string
	if cd, ok := s.Data().(*clientData); ok {
		roomID, role = cd.roomID, cd.role
	}
	h.mu.Lock()
	if roomID != "" && role != "" {
		if set := h.oidRegistry[roomID]; set != nil && set[role] != nil && set[role][id] {
			delete(set[role], id)
			remaining := len(set[role])
			if remaining == 0 {
				delete(set, role)
			}
			h.mu.Unlock()
			h.emitOidStatusUpdate(roomID)
			h.io.Emit("oid_disconnected", map[string]interface{}{"roomId": roomID, "role": role})
			logger.WsLog("["+roomID+"] "+role+" OID disconnected (socket="+id+", remaining="+itoa(remaining)+")", "info")
			h.mu.Lock()
		}
	}
	for _, rid := range services.GetRoomIDs() {
		if h.roomOwners[rid] == id {
			delete(h.roomOwners, rid)
			logger.WsLog("["+rid+"] Owner disconnected — clearing roomOwner", "info")
		}
	}
	delete(h.sockets, id)
	h.mu.Unlock()
	logger.WsLog("Client disconnected: "+id, "info")
}
