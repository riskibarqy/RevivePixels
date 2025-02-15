package main

import (
	"bufio"
	"context"
	"embed"
	"encoding/base64"
	"fmt"
	"log"
	"path/filepath"

	"github.com/riskibarqy/go-upscaler/backend"
	"github.com/riskibarqy/go-upscaler/backend/datatransfers"
	"github.com/riskibarqy/go-upscaler/backend/utils"

	"os"
	"strings"

	"github.com/wailsapp/wails/v2"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

var logger *utils.CustomLogger
var cancelFunc context.CancelFunc

// App struct
type App struct {
	ctx           context.Context
	videoUpscaler backend.VideoUpscalerUsecase
}

// NewApp creates a new App application struct
func NewApp() *App {
	videoUpscaler := backend.NewVideoUpscaler(logger)
	return &App{
		videoUpscaler: videoUpscaler,
	}
}

func (u *App) onSecondInstanceLaunch(secondInstanceData options.SecondInstanceData) {
	secondInstanceArgs := secondInstanceData.Args

	println("user opened second instance", strings.Join(secondInstanceData.Args, ","))
	println("user opened second from", secondInstanceData.WorkingDirectory)
	runtime.WindowUnminimise(u.ctx)
	runtime.Show(u.ctx)
	go runtime.EventsEmit(u.ctx, "launchArgs", secondInstanceArgs)
}

func (b *App) beforeClose(ctx context.Context) (prevent bool) {
	dialog, err := runtime.MessageDialog(ctx, runtime.MessageDialogOptions{
		Type:    runtime.QuestionDialog,
		Title:   "Quit?",
		Message: "Are you sure you want to quit?",
	})

	if err != nil {
		return false
	}

	return dialog != "Yes"
}

func (u *App) startup(ctx context.Context) {
	u.ctx = ctx

	// Create a pipe to capture stderr
	r, w, _ := os.Pipe()
	os.Stderr = w

	// Capture logs in a goroutine
	go func() {
		scanner := bufio.NewScanner(r)
		for scanner.Scan() {
			logMsg := strings.TrimSpace(scanner.Text())
			if logMsg != "" {

				// Send to frontend
				runtime.EventsEmit(ctx, "stderr_log", logMsg)
			}
		}
	}()

	go func() {
		<-ctx.Done()
	}()
}

// ProcessVideosFromUpload handles uploaded files, saves them, and processes them
func (u *App) ProcessVideosFromUpload(filesBase64 []string, filenames []string, model string) map[string]string {
	results := make(map[string]string)

	// Create a cancellable context
	ctx, cancel := context.WithCancel(u.ctx)
	cancelFunc = cancel // Store cancel function globally

	outputFolder, _ := utils.GetOutputVideoFolder()
	for i, base64Data := range filesBase64 {
		// Decode Base64 to []byte
		fileBytes, err := base64.StdEncoding.DecodeString(base64Data)
		if err != nil {
			results[filenames[i]] = "Failed to decode: " + err.Error()
			continue
		}

		tempDir, err := os.MkdirTemp(os.TempDir(), "go-upscaler")
		if err != nil {
			runtime.LogError(ctx, fmt.Sprintf("failed create temp dir : %v", err))
			continue
		}

		// Save file to temp directory
		tempFilePath := fmt.Sprintf("%s\\%s", tempDir, filenames[i])
		err = os.WriteFile(tempFilePath, fileBytes, 0644)
		if err != nil {
			results[filenames[i]] = "Failed to save: " + err.Error()
			continue
		}

		// ** Get File Details **
		fileInfo, err := os.Stat(tempFilePath)
		if err != nil {
			results[filenames[i]] = "Failed to get file info: " + err.Error()
			continue
		}

		savePath := outputFolder + "\\" + fmt.Sprintf("%d_upscaled_", utils.NowUnix()) + filenames[i]

		// Process video
		err = u.videoUpscaler.UpscaleVideoWithRealESRGAN(ctx, &datatransfers.VideoUpscalerRequest{
			InputPlainFileName: strings.TrimSuffix(fileInfo.Name(), filepath.Ext(tempFilePath)),
			InputFullFileName:  fileInfo.Name(),
			InputFileExt:       filepath.Ext(tempFilePath),
			InputFileSize:      fileInfo.Size(),
			TempFilePath:       tempFilePath,
			TempDir:            tempDir,
			Model:              model,
			SavePath:           savePath,
		})
		if err != nil {
			results[filenames[i]] = "Failed: " + err.Error()
		} else {
			results[filenames[i]] = "Success: " + savePath
		}
	}

	for _, v := range results {
		logger.Debug(v)
	}

	return results
}

func (u *App) CancelProcessing() {
	if cancelFunc != nil {
		cancelFunc() // Cancel all running tasks
		fmt.Println("Processing canceled by user.")
		logger.Warning("Processing canceled by user")
	}
}

func main() {
	var err error

	logger, err = utils.NewCustomLogger("app.log")
	if err != nil {
		log.Fatal("Failed to initialize logger:", err)
	}
	defer logger.Close()

	logger.Info("Application starting...")

	app := NewApp()

	err = wails.Run(&options.App{
		Title: "AI Video Upscaler",
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		EnableDefaultContextMenu: true,
		Width:                    600,
		Height:                   800,
		DisableResize:            false,
		Fullscreen:               false,
		MinWidth:                 400,
		MinHeight:                400,
		OnBeforeClose:            app.beforeClose,
		OnStartup:                app.startup,
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               "e3984e08-28dc-4e3d-b70a-45e961589cdc",
			OnSecondInstanceLaunch: app.onSecondInstanceLaunch,
		},
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		logger.Fatal(err.Error())
		println("Error:", err.Error())
	}
}
