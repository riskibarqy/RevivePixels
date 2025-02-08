package main

import (
	"bytes"
	"context"
	"embed"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS
var wailsContext *context.Context

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
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

		// Process video
		output := generateOutputFilename(tempFilePath)
		err = UpscaleVideoWithRealESRGAN(tempFilePath, output, model)
		if err != nil {
			results[filenames[i]] = "Failed: " + err.Error()
		} else {
			results[filenames[i]] = "Success: " + output
		}
	}

	return results
}

// ✅ Upscaling function using Real-ESRGAN
func UpscaleVideoWithRealESRGAN(input, output, model string) error {
	log.Printf("🚀 Starting upscale: %s with model: %s", input, model)

	// Check if input file exists
	if _, err := os.Stat(input); os.IsNotExist(err) {
		return fmt.Errorf("File not found: %s", input)
	}

	// Create frames directory
	frameDir := strings.TrimSuffix(input, filepath.Ext(input)) + "_frames"
	if err := os.MkdirAll(frameDir, os.ModePerm); err != nil {
		return fmt.Errorf("Failed to create frame directory: %v", err)
	}

	// ⚡ Use FFmpeg with GPU acceleration (NVDEC)
	framePattern := filepath.Join(frameDir, "frame_%04d.png")
	extractCmd := exec.Command("ffmpeg",
		"-hwaccel", "cuda", // ✅ Hardware Acceleration
		"-i", input,
		"-q:v", "2",
		framePattern,
	)
	extractCmd.Stdout, extractCmd.Stderr = os.Stdout, os.Stderr
	// Hide console window in Windows
	if runtime.GOOS == "windows" {
		extractCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	}
	if err := extractCmd.Run(); err != nil {
		return fmt.Errorf("Error extracting frames: %v", err)
	}

	// Extract audio from original video
	extractAudioCmd := exec.Command("ffmpeg", "-i", input, "-vn", "-acodec", "copy", "audio.aac")
	extractAudioCmd.Stdout, extractAudioCmd.Stderr = os.Stdout, os.Stderr
	// Hide console window in Windows
	if runtime.GOOS == "windows" {
		extractAudioCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	}
	if err := extractAudioCmd.Run(); err != nil {
		return fmt.Errorf("error extracting audio: %v", err)
	}

	// Get list of frames
	frames, err := filepath.Glob(filepath.Join(frameDir, "*.png"))
	if err != nil {
		return fmt.Errorf("Error finding frames: %v", err)
	}
	if len(frames) == 0 {
		return fmt.Errorf("No frames found in %s", frameDir)
	}

	// Process multiple frames in parallel
	var wg sync.WaitGroup
	sem := make(chan struct{}, 6) // ✅ Max 6 concurrent processes

	for _, frame := range frames {
		wg.Add(1)
		go func(frame string) {
			defer wg.Done()
			sem <- struct{}{} // Acquire slot

			outputFrame := filepath.Join(frameDir, "upscaled_"+filepath.Base(frame))
			cmd := exec.Command("realesrgan-ncnn-vulkan",
				"-i", frame,
				"-o", outputFrame,
				"-s", "2", // ✅ 2x scaling
				"-t", "1024", // ✅ Tile size to optimize VRAM usage
				"-g", "0", // ✅ Use first GPU (RTX 3060)
				" --fp16", // ✅ Enable Tensor Core acceleration
				"-n", model,
			)
			cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
			// Hide console window in Windows
			if runtime.GOOS == "windows" {
				cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
			}
			cmd.Run()

			<-sem // Release slot
		}(frame)
	}
	wg.Wait()

	// ⚡ Reassemble video with NVENC acceleration
	outputPattern := filepath.Join(frameDir, "upscaled_frame_%04d.png")
	// Reassemble video with upscaled frames and original audio
	assembleCmd := exec.Command("ffmpeg",
		"-r", "30",
		"-i", outputPattern,
		"-i", "audio.aac",
		"-c:v", "libx264",
		"-crf", "18",
		"-pix_fmt", "yuv420p",
		"-c:a", "copy",
		output,
	)
	assembleCmd.Stdout, assembleCmd.Stderr = os.Stdout, os.Stderr
	// Hide console window in Windows
	if runtime.GOOS == "windows" {
		assembleCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	}
	if err := assembleCmd.Run(); err != nil {
		return fmt.Errorf("error assembling video: %v", err)
	}

	log.Println("✅ Upscaling completed successfully!")
	return nil
}

// ✅ Generate output filename
func generateOutputFilename(input string) string {
	base := strings.TrimSuffix(input, filepath.Ext(input))
	return base + "_upscaled.mp4"
}

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title: "AI Video Upscaler",
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		Width:            800,
		Height:           600,
		DisableResize:    false,
		Fullscreen:       false,
		WindowStartState: options.Normal,
		MinWidth:         400,
		MinHeight:        400,
		// MaxWidth:  1280,
		// MaxHeight: 1024,
		// BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup: app.Startup,
		// OnDomReady:         app.domready,
		// OnShutdown:         app.shutdown,
		// OnBeforeClose:      app.beforeClose,
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               "e3984e08-28dc-4e3d-b70a-45e961589cdc",
			OnSecondInstanceLaunch: app.onSecondInstanceLaunch,
		},

		Windows: &windows.Options{
			WebviewIsTransparent:              false,
			WindowIsTranslucent:               false,
			BackdropType:                      windows.Mica,
			DisablePinchZoom:                  false,
			DisableWindowIcon:                 false,
			DisableFramelessWindowDecorations: false,
			WebviewUserDataPath:               "",
			WebviewBrowserPath:                "",
			Theme:                             windows.SystemDefault,
			CustomTheme: &windows.ThemeSettings{
				DarkModeTitleBar:   windows.RGB(20, 20, 20),
				DarkModeTitleText:  windows.RGB(200, 200, 200),
				DarkModeBorder:     windows.RGB(20, 0, 20),
				LightModeTitleBar:  windows.RGB(200, 200, 200),
				LightModeTitleText: windows.RGB(20, 20, 20),
				LightModeBorder:    windows.RGB(200, 200, 200),
			},
		},
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
