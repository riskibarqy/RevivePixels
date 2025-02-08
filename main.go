package main

import (
	"bytes"
	"context"
	"embed"
	"encoding/base64"
	"fmt"
	"go-upscaler/backend"
	"go-upscaler/backend/datatransfers"
	"go-upscaler/backend/utils"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS
var wailsContext *context.Context

// App struct
type App struct {
	ctx           context.Context
	videoUpscaler backend.VideoUpscaler
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		videoUpscaler: backend.VideoUpscaler{},
	}
}

func (a *App) onSecondInstanceLaunch(secondInstanceData options.SecondInstanceData) {
	secondInstanceArgs := secondInstanceData.Args

	println("user opened second instance", strings.Join(secondInstanceData.Args, ","))
	println("user opened second from", secondInstanceData.WorkingDirectory)
	wailsRuntime.WindowUnminimise(*wailsContext)
	wailsRuntime.Show(*wailsContext)
	go wailsRuntime.EventsEmit(*wailsContext, "launchArgs", secondInstanceArgs)
}

func (u *App) Startup(ctx context.Context) {
	u.ctx = ctx
	// Capture stderr and send logs to frontend
	r, w, _ := os.Pipe()
	os.Stderr = w

	// Capture logs in a goroutine
	go func() {
		var buf bytes.Buffer
		for {
			tmp := make([]byte, 1024)
			n, _ := r.Read(tmp)
			if n > 0 {
				buf.Write(tmp[:n])
				logMsg := strings.TrimSpace(buf.String())
				if logMsg != "" {
					wailsRuntime.EventsEmit(u.ctx, "stderr_log", logMsg) // Send to frontend
					buf.Reset()
				}
			}
		}
	}()
}

// ProcessVideosFromUpload handles uploaded files, saves them, and processes them
func (u *App) ProcessVideosFromUpload(filesBase64 []string, filenames []string, model string) map[string]string {
	results := make(map[string]string)
	outputFolder, _ := utils.GetOutputVideoFolder()
	for i, base64Data := range filesBase64 {
		// Decode Base64 to []byte
		fileBytes, err := base64.StdEncoding.DecodeString(base64Data)
		if err != nil {
			results[filenames[i]] = "Failed to decode: " + err.Error()
			continue
		}

		// Save file to temp directory
		tempFilePath := os.TempDir() + "/" + filenames[i]
		err = os.WriteFile(tempFilePath, fileBytes, 0644)
		if err != nil {
			results[filenames[i]] = "Failed to save: " + err.Error()
			continue
		}

		savePath := outputFolder + "\\" + fmt.Sprintf("%d_upscaled_", utils.NowUnix()) + filenames[i]

		// Process video
		err = u.UpscaleVideoWithRealESRGAN(&datatransfers.VideoUpscalerRequest{
			FullFileName: filenames[i],
			TempFilePath: tempFilePath,
			Model:        model,
			SavePath:     savePath,
		})
		if err != nil {
			results[filenames[i]] = "Failed: " + err.Error()
		} else {
			results[filenames[i]] = "Success: " + savePath
		}
	}

	return results
}

// ✅ Upscaling function using Real-ESRGAN
func (u *App) UpscaleVideoWithRealESRGAN(params *datatransfers.VideoUpscalerRequest) error {
	log.Printf("🚀 Starting upscale: %s with model: %s", params.FullFileName, params.Model)

	// Check if input file exists
	if _, err := os.Stat(params.TempFilePath); os.IsNotExist(err) {
		return fmt.Errorf("file not found: %s", params.TempFilePath)
	}

	// Create frames directory
	frameDir := strings.TrimSuffix(params.TempFilePath, filepath.Ext(params.TempFilePath)) + "_frames"
	if err := os.MkdirAll(frameDir, os.ModePerm); err != nil {
		return fmt.Errorf("failed to create frame directory: %v", err)
	}

	// Use FFmpeg with GPU acceleration (NVDEC) to extract video per frame
	if err := u.videoUpscaler.ExtractVideoFrames(frameDir, params.TempFilePath); err != nil {
		return fmt.Errorf("error extract video frames : %v", err)
	}

	// get details video, total frames & fps
	_, videoFPS, err := u.videoUpscaler.GetVideoFrames(params.TempFilePath)
	if err != nil {
		return fmt.Errorf("error get video detail : %v", err)
	}

	if params.VideoFPS == 0 {
		params.VideoFPS = videoFPS
	}

	splitFullFileName := strings.Split(params.FullFileName, ".")
	params.PlainFileName = splitFullFileName[0]
	params.FileExtension = splitFullFileName[1]
	params.AudioFileName = fmt.Sprintf("%s.aac", params.PlainFileName)

	// Extract audio from original video
	if err := u.videoUpscaler.ExtractAudio(params.TempFilePath, params.AudioFileName); err != nil {
		return fmt.Errorf("error extract audio : %v", err)
	}

	// Get list of frames
	frames, err := filepath.Glob(filepath.Join(frameDir, "*.png"))
	if err != nil {
		return fmt.Errorf("error finding frames: %v", err)
	}
	if len(frames) == 0 {
		return fmt.Errorf("no frames found in %s", frameDir)
	}

	// Process to upscale multiple frames in parallel
	if err := u.videoUpscaler.UpscaleFrames(frames, frameDir, params); err != nil {
		return fmt.Errorf("error upscale video : %v", err)
	}

	// Process to upscale multiple frames in parallel
	if err := u.videoUpscaler.ReassembleVideo(frameDir, params); err != nil {
		return fmt.Errorf("error reassemble video : %v", err)
	}

	log.Println("✅ Upscaling completed successfully!")

	defer func() {
		if err = utils.CleanupTempFiles(frameDir, params); err != nil {
			log.Println("failed to delete temp", err.Error())
		}
	}()

	return nil
}

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title: "AI Video Upscaler",
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		Width:            600,
		Height:           800,
		DisableResize:    false,
		Fullscreen:       false,
		WindowStartState: options.Normal,
		MinWidth:         400,
		MinHeight:        400,
		OnStartup:        app.Startup,
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               "e3984e08-28dc-4e3d-b70a-45e961589cdc",
			OnSecondInstanceLaunch: app.onSecondInstanceLaunch,
		},
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
