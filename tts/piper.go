// Package tts implements Piper (native binary) synthesis and the XTTS proxy.
package tts

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"starsim/config"
)

const piperSampleRate = 22050
const maxPiperTextLength = 4000

const (
	defaultFemaleVoice = "en_US-lessac-medium"
	defaultMaleVoice   = "en_US-ryan-high"
)

// CharacterVoiceMap maps character names to Piper voice model ids.
var CharacterVoiceMap = map[string]string{
	"Emily Carter":    "en_US-lessac-high",
	"Sarah Martinez":  "en_US-hfc_female-medium",
	"Lisa Nguyen":     "en_US-amy-medium",
	"Rachel Adams":    "en_US-kristin-medium",
	"Patricia Davis":  "en_US-ljspeech-high",
	"Barbara Miller":  "en_US-lessac-medium",
	"Daniel Brooks":   "en_US-ryan-high",
	"Marcus Thompson": "en_US-joe-medium",
	"James Anderson":  "en_US-norman-medium",
	"John Brown":      "en_US-bryce-medium",
	"David Davis":     "en_US-hfc_male-medium",
	"Robert Jones":    "en_US-ryan-medium",
}

func resolveVoiceID(speakerName, gender string) string {
	if v, ok := CharacterVoiceMap[speakerName]; ok {
		return v
	}
	if gender == "female" {
		return defaultFemaleVoice
	}
	return defaultMaleVoice
}

func pcmToWav(pcm []byte, sampleRate int) []byte {
	byteRate := sampleRate * 2
	buf := make([]byte, 44+len(pcm))
	copy(buf[0:4], "RIFF")
	binary.LittleEndian.PutUint32(buf[4:8], uint32(36+len(pcm)))
	copy(buf[8:12], "WAVE")
	copy(buf[12:16], "fmt ")
	binary.LittleEndian.PutUint32(buf[16:20], 16)
	binary.LittleEndian.PutUint16(buf[20:22], 1)
	binary.LittleEndian.PutUint16(buf[22:24], 1)
	binary.LittleEndian.PutUint32(buf[24:28], uint32(sampleRate))
	binary.LittleEndian.PutUint32(buf[28:32], uint32(byteRate))
	binary.LittleEndian.PutUint16(buf[32:34], 2)
	binary.LittleEndian.PutUint16(buf[34:36], 16)
	copy(buf[36:40], "data")
	binary.LittleEndian.PutUint32(buf[40:44], uint32(len(pcm)))
	copy(buf[44:], pcm)
	return buf
}

type piperError struct {
	status int
	body   map[string]interface{}
}

func (e *piperError) Error() string { return fmt.Sprintf("piper error %d", e.status) }

// synthesizePiper runs the Piper binary and returns WAV bytes (or a piperError).
func synthesizePiper(text, voiceID string) ([]byte, *piperError) {
	if len(text) > maxPiperTextLength {
		text = text[:maxPiperTextLength]
	}
	modelPath := filepath.Join(config.C.PiperVoicesDir, voiceID+".onnx")
	if _, err := os.Stat(config.C.PiperBin); err != nil {
		return nil, &piperError{status: 503, body: map[string]interface{}{"error": "Piper binary not found", "path": config.C.PiperBin}}
	}
	if _, err := os.Stat(modelPath); err != nil {
		return nil, &piperError{status: 404, body: map[string]interface{}{"error": "Voice model not found: " + voiceID, "path": modelPath}}
	}

	cmd := exec.Command(config.C.PiperBin, "--model", modelPath, "--output_raw", "--quiet")
	cmd.Stdin = strings.NewReader(text)
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Start(); err != nil {
		return nil, &piperError{status: 500, body: map[string]interface{}{"error": "Failed to spawn Piper process"}}
	}
	if err := cmd.Wait(); err != nil {
		code := 1
		if ee, ok := err.(*exec.ExitError); ok {
			code = ee.ExitCode()
		}
		return nil, &piperError{status: 500, body: map[string]interface{}{"error": "Piper synthesis failed", "code": code}}
	}
	return pcmToWav(out.Bytes(), piperSampleRate), nil
}

// listPiperVoices returns available .onnx voice ids in the voices directory.
func listPiperVoices() []string {
	entries, err := os.ReadDir(config.C.PiperVoicesDir)
	if err != nil {
		return nil
	}
	var voices []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".onnx") {
			voices = append(voices, strings.TrimSuffix(e.Name(), ".onnx"))
		}
	}
	return voices
}
