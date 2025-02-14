package utils

import (
	"go-upscaler/backend/datatransfers"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
	"time"
)

func HideWindowsCMD(cmd *exec.Cmd) {
	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	}
}

// CleanupTempFiles removes temporary frames to save disk space
func CleanupTempFiles(frameDir string, params *datatransfers.VideoUpscalerRequest) error {
	files, err := filepath.Glob(filepath.Join(frameDir, "*.png"))
	if err != nil {
		return err
	}
	for _, file := range files {
		_ = os.Remove(file)
	}

	return nil
}

func GetOutputVideoFolder() (string, error) {
	// Get the directory where the .exe is running
	exePath, err := os.Executable()
	if err != nil {
		return "", err
	}
	exeDir := filepath.Dir(exePath) // Get the folder where .exe is located

	// Create an "output_videos" folder next to the .exe
	outputFolder := filepath.Join(exeDir, "output_videos")
	if err := os.MkdirAll(outputFolder, os.ModePerm); err != nil {
		return "", err
	}

	return outputFolder, nil
}

func NowUnix() int {
	return int(time.Now().Unix())
}
