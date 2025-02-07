package main

import (
	"embed"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

// Upscale Video
func UpscaleVideo(input string, output string) error {
	// Convert Windows path to WSL path if necessary

	// Debugging: Print paths
	fmt.Println("Using input path:", input)
	fmt.Println("Using output path:", output)

	// Ensure the input file exists
	if _, err := os.Stat(input); os.IsNotExist(err) {
		return fmt.Errorf("failed to process input file: file does not exist: %s", input)
	}

	// Run FFmpeg command
	cmd := exec.Command("ffmpeg", "-i", input, "-vf", "scale=1920:1080", output)
	outputBytes, err := cmd.CombinedOutput()
	if err != nil {
		fmt.Println("FFmpeg execution failed:", string(outputBytes))
		return fmt.Errorf("error processing video: %v", err)
	}

	return nil
}

func main() {
	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:  "go-upscaler",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			&Upscaler{},
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

// Struct for binding
type Upscaler struct{}

// Function accessible from frontend
func (u *Upscaler) Process(input string, output string) string {
	err := UpscaleVideo(input, output)
	if err != nil {
		return "Error: " + err.Error()
	}
	return "Success"
}

// OpenFile using Zenity
func (u *Upscaler) OpenFile() string {
	cmd := exec.Command("zenity", "--file-selection")
	output, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}
