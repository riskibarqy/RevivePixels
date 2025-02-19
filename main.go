package main

import (
	"bufio"
	"context"
	"embed"
	"encoding/base64"
	"fmt"
	"log"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"

	"github.com/google/uuid"
	"github.com/riskibarqy/RevivePixels/backend"
	config "github.com/riskibarqy/RevivePixels/backend/confiig"
	"github.com/riskibarqy/RevivePixels/backend/constants"
	"github.com/riskibarqy/RevivePixels/backend/datatransfers"
	"github.com/riskibarqy/RevivePixels/backend/utils"

	"os"
	"strings"

	"github.com/wailsapp/wails/v2"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed embeds/ffmpeg/ffmpeg.exe embeds/ffmpeg/ffprobe.exe
var embeddedFFmpeg embed.FS

//go:embed embeds/realesrgan/realesrgan-ncnn-vulkan.exe embeds/realesrgan/models/*
var embeddedRealEsrgan embed.FS

var logger *utils.CustomLogger
var cancelFunc context.CancelFunc

// App struct
type App struct {
	ctx           context.Context
	videoUpscaler backend.VideoUpscalerUsecase
	sessionApps   *sync.Map // Store session data
}

// NewApp creates a new App application struct
func NewApp() *App {
	sessionApps := &sync.Map{} // Initialize sessionApps
	videoUpscaler := backend.NewVideoUpscaler(logger, sessionApps)
	return &App{
		videoUpscaler: videoUpscaler,
		sessionApps:   sessionApps,
	}
}

// Extracts ffmpeg & ffprobe to a temp directory
func (u *App) ExtractFFmpeg() error {
	tempDirRaw, ok := u.sessionApps.Load(constants.CtxKeyRootTempDir)
	if !ok {
		return fmt.Errorf("rootTempDir not found in session")
	}

	rootTempDir, ok := tempDirRaw.(string)
	if !ok {
		return fmt.Errorf("rootTempDir is not a string")
	}

	// Extract ffmpeg
	ffmpegPath := filepath.Join(rootTempDir, "ffmpeg.exe")
	if err := extractFileEmbedded(constants.FileTypeEmbedFFMPEG, "embeds/ffmpeg/ffmpeg.exe", ffmpegPath); err != nil {
		return err
	}

	// Extract ffprobe
	ffprobePath := filepath.Join(rootTempDir, "ffprobe.exe")
	if err := extractFileEmbedded(constants.FileTypeEmbedFFMPEG, "embeds/ffmpeg/ffprobe.exe", ffprobePath); err != nil {
		return err
	}

	return nil
}

// Extracts realersgan and its model to a temp directory
func (u *App) ExtractRealEsrgan() error {
	tempDirRaw, ok := u.sessionApps.Load(constants.CtxKeyRootTempDir)
	if !ok {
		return fmt.Errorf("rootTempDir not found in session")
	}

	rootTempDir, ok := tempDirRaw.(string)
	if !ok {
		return fmt.Errorf("rootTempDir is not a string")
	}

	// Extract Real-ESRGAN executable
	esrganPath := filepath.Join(rootTempDir, "realesrgan-ncnn-vulkan.exe")
	if err := extractFileEmbedded(constants.FileTypeEmbedRealesrgan, "embeds/realesrgan/realesrgan-ncnn-vulkan.exe", esrganPath); err != nil {
		return err
	}

	// // Extract Real-ESRGAN executable
	// vcomp140Path := filepath.Join(rootTempDir, "vcomp140.dll")
	// if err := extractFileEmbedded(constants.FileTypeEmbedRealesrgan, "embeds/realesrgan/vcomp140.dll", vcomp140Path); err != nil {
	// 	return err
	// }

	// // Extract Real-ESRGAN executable
	// vcomp140dPath := filepath.Join(rootTempDir, "vcomp140d.dll")
	// if err := extractFileEmbedded(constants.FileTypeEmbedRealesrgan, "embeds/realesrgan/vcomp140d.dll", vcomp140dPath); err != nil {
	// 	return err
	// }

	// Extract model files
	modelsDir := filepath.Join(rootTempDir, "models")
	if err := os.MkdirAll(modelsDir, 0755); err != nil {
		return err
	}

	modelFiles := []string{
		"embeds/realesrgan/models/realesr-animevideov3-x2.bin",
		"embeds/realesrgan/models/realesr-animevideov3-x2.param",
		"embeds/realesrgan/models/realesr-animevideov3-x3.bin",
		"embeds/realesrgan/models/realesr-animevideov3-x3.param",
		"embeds/realesrgan/models/realesr-animevideov3-x4.bin",
		"embeds/realesrgan/models/realesr-animevideov3-x4.param",
		"embeds/realesrgan/models/realesrgan-x4plus-anime.bin",
		"embeds/realesrgan/models/realesrgan-x4plus-anime.param",
		"embeds/realesrgan/models/realesrgan-x4plus.bin",
		"embeds/realesrgan/models/realesrgan-x4plus.param",
	}

	for _, model := range modelFiles {
		dst := filepath.Join(modelsDir, filepath.Base(model))
		err := extractFileEmbedded(constants.FileTypeEmbedRealesrgan, model, dst)
		if err != nil {
			log.Printf("Failed to extract %s: %v", model, err)
		} else {
			log.Printf("Extracted model: %s", dst)
		}
	}

	return nil
}

// Helper function to extract a file
func extractFileEmbedded(filetype, src string, dst string) error {
	var err error
	var data []byte

	switch filetype {
	case constants.FileTypeEmbedFFMPEG:
		data, err = embeddedFFmpeg.ReadFile(src)
		if err != nil {
			return fmt.Errorf("failed to read embedded file %s: %v", src, err)
		}
	case constants.FileTypeEmbedRealesrgan:
		data, err = embeddedRealEsrgan.ReadFile(src)
		if err != nil {
			return fmt.Errorf("failed to read embedded file %s: %v", src, err)
		}
	}

	if err := os.WriteFile(dst, data, 0755); err != nil {
		return fmt.Errorf("failed to write file %s: %v", dst, err)
	}

	return nil
}

func (u *App) onSecondInstanceLaunch(secondInstanceData options.SecondInstanceData) {
	secondInstanceArgs := secondInstanceData.Args

	println("user opened second instance", strings.Join(secondInstanceData.Args, ","))
	println("user opened second from", secondInstanceData.WorkingDirectory)
	runtime.WindowUnminimise(u.ctx)
	runtime.Show(u.ctx)
	go runtime.EventsEmit(u.ctx, "launchArgs", secondInstanceArgs)
}

func (u *App) beforeClose(ctx context.Context) (prevent bool) {
	dialog, err := runtime.MessageDialog(ctx, runtime.MessageDialogOptions{
		Type:    runtime.QuestionDialog,
		Title:   "Quit?",
		Message: "Are you sure you want to quit?",
	})

	if err != nil {
		return false
	}

	if dialog == "Yes" {
		u.CleanupRootTempFolder() // Cleanup temp before exiting
		return false
	}
	return true
}

func (u *App) startup(ctx context.Context) {
	u.ctx = ctx

	sessionId := utils.GetSessionValue(u.sessionApps, constants.CtxSessionID)
	appName := utils.GetSessionValue(u.sessionApps, constants.CtxAppName)

	tempDir, _ := os.MkdirTemp(os.TempDir(), fmt.Sprintf("%s-%s", appName, sessionId))

	u.sessionApps.Store(constants.CtxKeyRootTempDir, tempDir)

	err := u.ExtractFFmpeg()
	if err != nil {
		log.Fatal(err)
	}

	err = u.ExtractRealEsrgan()
	if err != nil {
		log.Fatal("Failed to extract Real-ESRGAN:", err)
	}

	u.sessionApps.Store(constants.CtxFFmpegPath, tempDir+"/ffmpeg.exe")
	u.sessionApps.Store(constants.CtxFFprobePath, tempDir+"/ffprobe.exe")
	u.sessionApps.Store(constants.CtxRealesrganPath, tempDir+"/realesrgan-ncnn-vulkan.exe")

	if err := config.InitializePaths(u.sessionApps); err != nil {
		log.Fatal("Failed to initialize paths:", err)
	}

	// Create a pipe to capture stderr
	r, w, _ := os.Pipe()
	os.Stderr = w

	// Capture logs in a goroutine
	go func() {
		defer w.Close() // Close pipe when done
		scanner := bufio.NewScanner(r)
		for scanner.Scan() {
			logMsg := strings.TrimSpace(scanner.Text())
			if logMsg != "" {
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

	rootTempDir := utils.GetSessionValue(u.sessionApps, constants.CtxKeyRootTempDir)

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

		tempDir, err := os.MkdirTemp(rootTempDir, fmt.Sprintf("%d", i))
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

		savePath := filepath.Join(outputFolder, fmt.Sprintf("%d_upscaled_", utils.NowUnix())+filenames[i])

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
		cancelFunc = nil // Reset cancelFunc to avoid conflicts
	}
}

func (u *App) CleanupRootTempFolder() {
	rootTempDir := utils.GetSessionValue(u.sessionApps, constants.CtxKeyRootTempDir)
	err := os.RemoveAll(rootTempDir)
	if err != nil {
		logger.Error(err.Error())
	}
}

func (u *App) gracefulShutdown() {
	s := make(chan os.Signal, 1)
	signal.Notify(s, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-s
		u.CleanupRootTempFolder() // Cleanup before exiting
		fmt.Println("Shutting down gracefully.")
		os.Exit(0)
	}()
}

func main() {
	var err error

	logger, err = utils.NewCustomLogger("app.log")
	if err != nil {
		log.Fatal("Failed to initialize logger:", err)
	}
	defer logger.Close()

	app := NewApp()

	appName := "revivePixels"
	uuid := uuid.New().String()

	app.sessionApps.Store(constants.CtxSessionID, uuid)
	app.sessionApps.Store(constants.CtxAppName, appName)

	logger.Info("Application starting...")
	logger.Info("App Name : " + appName)
	logger.Info("Session ID : " + uuid)

	go app.gracefulShutdown()

	// Ensure temp files are deleted on exit
	defer app.CleanupRootTempFolder()
	defer func() {
		if r := recover(); r != nil {
			logger.Error(fmt.Sprintf("App crashed: %v", r))
			app.CleanupRootTempFolder()
		}
	}()

	err = wails.Run(&options.App{
		Title: appName,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		EnableDefaultContextMenu: true,
		Width:                    1080,
		Height:                   800,
		DisableResize:            false,
		Fullscreen:               false,
		MinWidth:                 800,
		MinHeight:                600,
		OnBeforeClose:            app.beforeClose,
		OnStartup:                app.startup,
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               uuid,
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
