package main

import (
	"context"
	"embed"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

type Upscaler struct {
	ctx context.Context
}

func (u *Upscaler) Startup(ctx context.Context) {
	u.ctx = ctx
}

// ✅ Open multiple files
func (u *Upscaler) OpenFiles() ([]string, error) {
	if u.ctx == nil {
		return nil, fmt.Errorf("context is nil")
	}

	files, err := runtime.OpenMultipleFilesDialog(u.ctx, runtime.OpenDialogOptions{
		Title: "Select Video Files",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "Video Files",
				Pattern:     "*.mp4;*.avi;*.mkv",
			},
		},
	})
	if err != nil {
		return nil, err
	}
	return files, nil
}

// ✅ Upscale videos using Real-ESRGAN
func (u *Upscaler) ProcessVideos(inputFiles []string, model string) map[string]string {
	results := make(map[string]string)

	for _, input := range inputFiles {
		output := generateOutputFilename(input)
		err := UpscaleVideoWithRealESRGAN(input, output, model)
		if err != nil {
			results[input] = "Failed: " + err.Error()
		} else {
			results[input] = "Success: " + output
		}
	}

	return results
}

// ✅ Upscaling function using Real-ESRGAN
// UpscaleVideoWithRealESRGAN upscales a video using Real-ESRGAN
func UpscaleVideoWithRealESRGAN(input, output, model string) error {
	log.Printf("Starting upscale: %s with model: %s", input, model)

	// Check if input file exists
	if _, err := os.Stat(input); os.IsNotExist(err) {
		return fmt.Errorf("file not found: %s", input)
	}

	// Create frames directory
	frameDir := strings.TrimSuffix(input, filepath.Ext(input)) + "_frames"
	if err := os.MkdirAll(frameDir, os.ModePerm); err != nil {
		return fmt.Errorf("failed to create frame directory: %v", err)
	}

	// Extract frames using FFmpeg
	framePattern := filepath.Join(frameDir, "frame_%04d.png")
	extractCmd := exec.Command("ffmpeg", "-i", input, "-q:v", "2", framePattern) // Higher quality frames
	extractCmd.Stdout, extractCmd.Stderr = os.Stdout, os.Stderr
	if err := extractCmd.Run(); err != nil {
		return fmt.Errorf("error extracting frames: %v", err)
	}

	// Get list of frames
	frames, err := filepath.Glob(filepath.Join(frameDir, "*.png"))
	if err != nil {
		return fmt.Errorf("error finding frames: %v", err)
	}
	if len(frames) == 0 {
		return fmt.Errorf("no frames found in %s", frameDir)
	}

	// Process multiple frames in parallel
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4) // Max 4 concurrent processes

	for _, frame := range frames {
		wg.Add(1)
		go func(frame string) {
			defer wg.Done()
			sem <- struct{}{} // Acquire slot

			outputFrame := filepath.Join(frameDir, "upscaled_"+filepath.Base(frame))
			cmd := exec.Command("realesrgan-ncnn-vulkan",
				"-i", frame,
				"-o", outputFrame,
				"-s", "2", // Enable 2x scaling
				"-t", "512", // Use a tile size that balances GPU load
				"-g", "0", // Use first GPU
				" --fp16", // Enable Tensor Core acceleration
				"-n", model,
			)
			cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
			cmd.Run()

			<-sem // Release slot
		}(frame)
	}
	wg.Wait()

	// Reassemble video from upscaled frames
	outputPattern := filepath.Join(frameDir, "upscaled_frame_%04d.png")
	assembleCmd := exec.Command("ffmpeg",
		"-r", "30", // Ensure correct frame rate
		"-i", outputPattern,
		"-c:v", "libx264",
		"-crf", "18",
		"-pix_fmt", "yuv420p", // Ensures broad compatibility
		output,
	)
	assembleCmd.Stdout, assembleCmd.Stderr = os.Stdout, os.Stderr
	if err := assembleCmd.Run(); err != nil {
		return fmt.Errorf("error assembling video: %v", err)
	}

	log.Println("Upscaling completed successfully!")
	return nil
}

// ✅ Generate output filename
func generateOutputFilename(input string) string {
	base := strings.TrimSuffix(input, filepath.Ext(input))
	return base + "_upscaled.mp4"
}

func main() {
	app := &Upscaler{}

	err := wails.Run(&options.App{
		Title:  "AI Video Upscaler",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.Startup,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
