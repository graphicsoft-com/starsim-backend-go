package main

import (
	"starsim/handlers"
	"starsim/tts"

	"github.com/gin-gonic/gin"
)

func registerSimulation(api *gin.RouterGroup, simLimiter gin.HandlerFunc) {
	g := api.Group("/simulation")
	g.POST("/start/:roomId", simLimiter, handlers.StartSimulation)
	g.POST("/stop/:roomId", simLimiter, handlers.StopSimulation)
	g.GET("/status", handlers.GetAllRoomStatuses)
	g.POST("/start-all", simLimiter, handlers.StartAllSimulations)
	g.PATCH("/room-config/:roomId", handlers.UpdateRoomConfigPatch)
	g.POST("/create-room", handlers.CreateRoom)
	g.DELETE("/delete-room/:roomId", handlers.DeleteRoom)
}

func registerRoomConfig(api *gin.RouterGroup) {
	g := api.Group("/room-config")
	g.GET("", handlers.GetAllRoomConfigs)
	g.GET("/:roomId", handlers.GetRoomConfig)
	g.PUT("/:roomId", handlers.UpdateRoomConfig)
	g.POST("", handlers.CreateRoomConfig)
	g.DELETE("/:roomId", handlers.DeleteRoomConfig)
}

func registerCharacters(api *gin.RouterGroup) {
	g := api.Group("/characters")
	g.GET("", handlers.GetCharacters)
	g.POST("", handlers.CreateCharacter)
	g.PUT("/:id", handlers.UpdateCharacter)
	g.DELETE("/:id", handlers.DeleteCharacter)
}

func registerSchedule(api *gin.RouterGroup) {
	g := api.Group("/schedule")
	g.GET("", handlers.GetSchedule)
	g.PUT("", handlers.UpdateSchedule)
	g.POST("/toggle", handlers.ToggleSchedule)
}

func registerAudio(api *gin.RouterGroup) {
	g := api.Group("/audio")
	g.POST("/upload", handlers.UploadAudio)
	g.POST("/upload-session", handlers.UploadSessionAudio)
	g.GET("/session/:roomId/:sessionId/merged", handlers.MergedSessionAudio)
	g.GET("/session/:roomId/:sessionId", handlers.ListSessionAudio)
}

func registerNebo(api *gin.RouterGroup) {
	g := api.Group("/nebo")
	g.POST("/register/:roomId", handlers.RegisterNebo)
}

func registerTranscripts(api *gin.RouterGroup) {
	g := api.Group("/transcripts")
	g.GET("/:id", handlers.GetRoomSessions)
	g.GET("/:id/messages", handlers.GetSessionMessages)
}

func registerResidents(api *gin.RouterGroup) {
	g := api.Group("/residents")
	g.GET("", handlers.ListResidents)
	g.GET("/:id", handlers.GetResident)
	g.GET("/:id/days", handlers.GetResidentDays)
	g.GET("/:id/days/:dayIndex", handlers.GetResidentDay)
	g.GET("/:id/days/:dayIndex/encounters", handlers.GetDayEncounters)
	g.GET("/:id/encounters/:encounterId", handlers.GetEncounter)
	g.POST("/:id/encounters/openmrs", handlers.GetEncounterOpenMRS)
	g.GET("/:id/today-schedule", handlers.GetTodaySchedule)
	g.POST("/:id/run-day", handlers.RunDay)
}

func registerNoteSequence(api *gin.RouterGroup) {
	g := api.Group("/note-sequence")
	g.GET("", handlers.ListNoteTypes)
	g.POST("/seed", handlers.SeedNoteTypes)
	g.PUT("/reorder", handlers.ReorderNoteTypes)
	g.PUT("/:id", handlers.UpdateNoteType)
	g.DELETE("/:id", handlers.DeleteNoteType)
	g.POST("", handlers.CreateNoteType)
}

func registerTTS(api *gin.RouterGroup, ttsLimiter gin.HandlerFunc) {
	g := api.Group("/tts", ttsLimiter)
	g.POST("", tts.XTTSSynthesize)
	g.GET("/health", tts.XTTSHealth)

	p := g.Group("/piper")
	p.POST("", tts.PiperSynthesize)
	p.GET("/health", tts.PiperHealth)
}
