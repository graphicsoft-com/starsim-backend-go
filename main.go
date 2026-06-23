package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"starsim/config"
	"starsim/db"
	"starsim/engine"
	"starsim/handlers"
	"starsim/logger"
	"starsim/middleware"
	"starsim/services"
	"starsim/static"
	"starsim/ttsconfig"
	wsx "starsim/websocket"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
)

func main() {
	// 1. Load .env + config
	cfg := config.Load()

	// 2. Init logger
	logger.Init(cfg.LogLevel)

	// 3. Connect MongoDB
	ctx := context.Background()
	if err := db.Connect(ctx, cfg.MongoURI, cfg.MongoDBName); err != nil {
		logger.Error("MongoDB connection failed: "+err.Error(), nil)
		os.Exit(1)
	}

	// 4. Clean up orphaned active sessions from a previous run
	_, _ = db.Coll(db.CollSessions).UpdateMany(ctx, bson.M{"status": "active"},
		bson.M{"$set": bson.M{"status": "stopped", "endTime": time.Now()}})
	logger.Info("Cleaned up orphaned active sessions", nil)

	// 5. Seed idempotently
	services.SeedRoomConfigs()
	services.SeedCharacters()
	services.SeedResidents()
	services.LoadRoomRegistry()

	// 6. Init subsystems
	ttsconfig.Init()
	services.InitAlerts(cfg.GoogleChatWebhookURL)
	services.InitS3()

	// 7. WebSocket hub + engine wiring
	hub := wsx.NewHub()
	engine.SetEmitter(hub)
	engine.HookAlertSessionStarted = services.AlertSessionStarted
	engine.HookAlertSessionStopped = services.AlertSessionStopped
	engine.HookRegisterEncounterWithNebo = func(roomID, sessionID string) {
		services.RegisterEncounterWithNebo(roomID, sessionID, "")
	}
	engine.HookGetProvider = ttsconfig.GetProvider

	// 8. Scheduler
	sched := services.NewScheduler()
	if cfg.RunScheduler {
		sched.Start()
	} else {
		logger.Info("[Scheduler] Disabled on this instance", nil)
	}

	// 9. Build router
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.MaxMultipartMemory = 50 << 20 // 50MB uploads

	r.Use(middleware.BlockSensitivePaths())
	r.Use(middleware.RequestID())
	r.Use(middleware.RequestLogger())
	r.Use(middleware.CORS())
	r.Use(middleware.Recovery())

	r.GET("/health", handlers.Health)

	// Socket.IO endpoint (no rate limiting)
	socketHandler := gin.WrapH(hub.Handler())
	r.Any("/socket.io/*any", socketHandler)

	// Voice reference WAVs (best-effort static dir)
	if cfg.VoicesDir != "" {
		if fi, err := os.Stat(cfg.VoicesDir); err == nil && fi.IsDir() {
			r.Static("/voices", cfg.VoicesDir)
		}
	}

	apiLimiter := middleware.NewRateLimiter(60000, 100, "Too many requests, please try again later.")
	ttsLimiter := middleware.NewRateLimiter(60000, 30, "TTS rate limit exceeded — XTTS server protection")
	simLimiter := middleware.NewRateLimiter(60000, 10, "")

	api := r.Group("/api", apiLimiter)
	api.GET("/config", handlers.Config)

	registerSimulation(api, simLimiter)
	registerRoomConfig(api)
	registerCharacters(api)
	registerSchedule(api)
	registerAudio(api)
	registerNebo(api)
	registerTranscripts(api)
	registerResidents(api)
	registerNoteSequence(api)
	registerTTS(api, ttsLimiter)

	// 10. Static client + SPA fallback (after all API routes)
	static.Register(r, cfg.ClientDistPath)

	srv := &http.Server{Addr: "0.0.0.0:" + cfg.Port, Handler: r}

	go func() {
		logger.LogStartupSummary(cfg.Port, cfg.MongoURI, cfg.NodeEnv)
		logger.Info("[Config] Instance="+cfg.InstanceName+" | TTS="+cfg.TTSMode, logger.Fields{"scope": "startup"})
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("HTTP server error: "+err.Error(), nil)
			os.Exit(1)
		}
	}()

	// Optional auto-start of all rooms
	if cfg.StartAll {
		go func() {
			for _, roomID := range services.GetRoomIDs() {
				if _, err := engine.StartRoomScheduled(roomID, false); err != nil {
					logger.Info("Auto-start "+roomID+": "+err.Error(), nil)
				}
			}
		}()
	}

	gracefulShutdown(srv, sched)
}

func gracefulShutdown(srv *http.Server, sched *services.Scheduler) {
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	logger.Info("Received "+sig.String()+" — shutting down gracefully", nil)

	sched.Stop()
	for roomID := range engine.GetAllRoomStatuses() {
		engine.StopRoom(roomID, "server_restart")
		logger.Info("Stopped "+roomID+" for server restart", nil)
	}
	// Give room loops a moment to finalize and send alerts
	time.Sleep(3 * time.Second)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	_ = db.Disconnect(ctx)
	logger.Info("Shutdown complete", nil)
}
