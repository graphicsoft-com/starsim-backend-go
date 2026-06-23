// Package static serves the unchanged React client build (client/dist) and the
// SPA fallback to index.html for non-API routes.
package static

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// Register wires static asset serving + SPA fallback into the router. It must be
// registered after all API routes.
func Register(r *gin.Engine, distPath string) {
	indexPath := filepath.Join(distPath, "index.html")

	r.NoRoute(func(c *gin.Context) {
		p := c.Request.URL.Path
		// API and socket routes that fell through → JSON 404
		if strings.HasPrefix(p, "/api") || strings.HasPrefix(p, "/socket.io") {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "Route not found: " + p})
			return
		}
		// Try to serve a real static file
		clean := filepath.Clean(p)
		candidate := filepath.Join(distPath, clean)
		if rel, err := filepath.Rel(distPath, candidate); err == nil && !strings.HasPrefix(rel, "..") {
			if fi, err := os.Stat(candidate); err == nil && !fi.IsDir() {
				c.Header("Cross-Origin-Opener-Policy", "same-origin")
				c.Header("Cross-Origin-Embedder-Policy", "credentialless")
				c.File(candidate)
				return
			}
		}
		// SPA fallback
		c.Header("Cross-Origin-Opener-Policy", "same-origin")
		c.Header("Cross-Origin-Embedder-Policy", "credentialless")
		c.File(indexPath)
	})
}
