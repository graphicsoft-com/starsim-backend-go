package services

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"time"

	"starsim/config"
	"starsim/logger"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

var s3Client *s3.Client

// InitS3 constructs the MinIO/S3 client (path-style addressing).
func InitS3() {
	endpoint := config.C.MinioEndpoint
	if endpoint == "" {
		return
	}
	if !strings.HasPrefix(endpoint, "http") {
		endpoint = "https://" + endpoint
	}
	s3Client = s3.New(s3.Options{
		Region:       "us-east-1",
		Credentials:  credentials.NewStaticCredentialsProvider(config.C.MinioAccessKey, config.C.MinioSecretKey, ""),
		BaseEndpoint: aws.String(endpoint),
		UsePathStyle: true,
	})
}

func bucket() string { return config.C.S3BucketName }

func publicURL(key string) string {
	ep := strings.TrimRight(config.C.MinioEndpoint, "/")
	return fmt.Sprintf("%s/%s/%s", ep, bucket(), key)
}

// UploadResult is returned by UploadBuffer.
type UploadResult struct {
	Key    string
	URL    string
	SizeMb string
}

// UploadBuffer stores raw bytes under key and returns its public URL + size.
func UploadBuffer(key string, data []byte, mimeType string) (UploadResult, error) {
	if s3Client == nil {
		return UploadResult{}, fmt.Errorf("S3 client not configured")
	}
	if mimeType == "" {
		mimeType = "audio/wav"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	_, err := s3Client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(bucket()),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String(mimeType),
	})
	if err != nil {
		return UploadResult{}, err
	}
	return UploadResult{Key: key, URL: publicURL(key), SizeMb: fmt.Sprintf("%.2f", float64(len(data))/1024/1024)}, nil
}

// AudioFileEntry describes one stored per-session audio object.
type AudioFileEntry struct {
	Key          string `json:"key"`
	URL          string `json:"url"`
	FileName     string `json:"fileName"`
	Role         string `json:"role"`
	LastModified string `json:"lastModified"`
	SizeMb       string `json:"sizeMb"`
}

// ListSessionAudio lists per-session audio objects (excluding /turns/).
func ListSessionAudio(roomID, sessionID string) ([]AudioFileEntry, error) {
	if s3Client == nil {
		return nil, fmt.Errorf("S3 client not configured")
	}
	prefix := fmt.Sprintf("audio/%s/%s/", roomID, sessionID)
	ctx := context.Background()
	var entries []AudioFileEntry
	p := s3.NewListObjectsV2Paginator(s3Client, &s3.ListObjectsV2Input{
		Bucket: aws.String(bucket()), Prefix: aws.String(prefix),
	})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		for _, o := range page.Contents {
			key := aws.ToString(o.Key)
			if strings.Contains(key, "/turns/") {
				continue
			}
			parts := strings.Split(key, "/")
			fileName := parts[len(parts)-1]
			role := "unknown"
			if seg := strings.Split(fileName, "_"); len(seg) > 0 {
				role = seg[0]
			}
			lm := ""
			if o.LastModified != nil {
				lm = o.LastModified.Format(time.RFC3339)
			}
			size := "—"
			if o.Size != nil {
				size = fmt.Sprintf("%.2f", float64(*o.Size)/1024/1024)
			}
			entries = append(entries, AudioFileEntry{
				Key: key, URL: publicURL(key), FileName: fileName, Role: role, LastModified: lm, SizeMb: size,
			})
		}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].LastModified < entries[j].LastModified })
	return entries, nil
}

func getObject(key string) ([]byte, error) {
	ctx := context.Background()
	out, err := s3Client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(bucket()), Key: aws.String(key)})
	if err != nil {
		return nil, err
	}
	defer out.Body.Close()
	return io.ReadAll(out.Body)
}

type pcmWav struct {
	sampleRate    uint32
	channels      uint16
	bitsPerSample uint16
	pcm           []byte
}

func parsePcmWav(buf []byte) pcmWav {
	if len(buf) < 44 {
		return pcmWav{sampleRate: 22050, channels: 1, bitsPerSample: 16}
	}
	w := pcmWav{
		channels:      binary.LittleEndian.Uint16(buf[22:24]),
		sampleRate:    binary.LittleEndian.Uint32(buf[24:28]),
		bitsPerSample: binary.LittleEndian.Uint16(buf[34:36]),
	}
	dataSize := binary.LittleEndian.Uint32(buf[40:44])
	end := 44 + int(dataSize)
	if end > len(buf) || dataSize == 0 {
		end = len(buf)
	}
	w.pcm = buf[44:end]
	return w
}

// BuildPcmWav wraps PCM samples in a 44-byte RIFF/WAVE header.
func BuildPcmWav(pcm []byte, sampleRate uint32, channels, bitsPerSample uint16) []byte {
	byteRate := sampleRate * uint32(channels) * uint32(bitsPerSample/8)
	blockAlign := channels * (bitsPerSample / 8)
	buf := make([]byte, 44+len(pcm))
	copy(buf[0:4], "RIFF")
	binary.LittleEndian.PutUint32(buf[4:8], uint32(36+len(pcm)))
	copy(buf[8:12], "WAVE")
	copy(buf[12:16], "fmt ")
	binary.LittleEndian.PutUint32(buf[16:20], 16)
	binary.LittleEndian.PutUint16(buf[20:22], 1)
	binary.LittleEndian.PutUint16(buf[22:24], channels)
	binary.LittleEndian.PutUint32(buf[24:28], sampleRate)
	binary.LittleEndian.PutUint32(buf[28:32], byteRate)
	binary.LittleEndian.PutUint16(buf[32:34], blockAlign)
	binary.LittleEndian.PutUint16(buf[34:36], bitsPerSample)
	copy(buf[36:40], "data")
	binary.LittleEndian.PutUint32(buf[40:44], uint32(len(pcm)))
	copy(buf[44:], pcm)
	return buf
}

// MergeResult is returned by MergeSessionAudio.
type MergeResult struct {
	Buffer    []byte
	TurnCount int
	SizeMb    string
	Key       string
	URL       string
}

// MergeSessionAudio concatenates per-turn WAVs into one full_session.wav,
// inserting `silenceMs` of silence between turns. Caches the merged result.
func MergeSessionAudio(roomID, sessionID string, silenceMs int) (MergeResult, error) {
	if s3Client == nil {
		return MergeResult{}, fmt.Errorf("S3 client not configured")
	}
	mergedKey := fmt.Sprintf("audio/%s/%s/full_session.wav", roomID, sessionID)

	if cached, err := getObject(mergedKey); err == nil && len(cached) > 0 {
		size := fmt.Sprintf("%.2f", float64(len(cached))/1024/1024)
		logger.Info(fmt.Sprintf("[minioService] Serving cached merged WAV → %s (%s MB)", mergedKey, size), nil)
		return MergeResult{Buffer: cached, TurnCount: 0, SizeMb: size, Key: mergedKey, URL: publicURL(mergedKey)}, nil
	}

	turnsPrefix := fmt.Sprintf("audio/%s/%s/turns/", roomID, sessionID)
	ctx := context.Background()
	var keys []string
	p := s3.NewListObjectsV2Paginator(s3Client, &s3.ListObjectsV2Input{
		Bucket: aws.String(bucket()), Prefix: aws.String(turnsPrefix),
	})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return MergeResult{}, err
		}
		for _, o := range page.Contents {
			keys = append(keys, aws.ToString(o.Key))
		}
	}
	if len(keys) == 0 {
		return MergeResult{}, fmt.Errorf("No turn audio files found for session %s/%s", roomID, sessionID)
	}

	turnNum := func(key string) int {
		parts := strings.Split(key, "/")
		fn := parts[len(parts)-1]
		seg := strings.Split(fn, "_")
		if len(seg) > 1 {
			n, _ := strconv.Atoi(seg[1])
			return n
		}
		return 0
	}
	sort.Slice(keys, func(i, j int) bool { return turnNum(keys[i]) < turnNum(keys[j]) })

	var parsed []pcmWav
	for _, k := range keys {
		data, err := getObject(k)
		if err != nil {
			return MergeResult{}, err
		}
		parsed = append(parsed, parsePcmWav(data))
	}

	first := parsed[0]
	bytesPerSample := int(first.bitsPerSample / 8)
	silenceSamples := int(first.sampleRate) * silenceMs / 1000
	silencePcm := make([]byte, silenceSamples*int(first.channels)*bytesPerSample)

	var combined bytes.Buffer
	for i, w := range parsed {
		if i > 0 {
			combined.Write(silencePcm)
		}
		combined.Write(w.pcm)
	}

	wav := BuildPcmWav(combined.Bytes(), first.sampleRate, first.channels, first.bitsPerSample)
	res, err := UploadBuffer(mergedKey, wav, "audio/wav")
	if err != nil {
		return MergeResult{}, err
	}
	logger.Info(fmt.Sprintf("[minioService] Merged WAV saved → %s (%s MB)", mergedKey, res.SizeMb), nil)
	return MergeResult{Buffer: wav, TurnCount: len(keys), SizeMb: res.SizeMb, Key: mergedKey, URL: res.URL}, nil
}
