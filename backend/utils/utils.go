package utils

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

func HideWindowsCMD(cmd *exec.Cmd) {
	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	}
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

func IgnoreError(errString string) bool {
	if strings.Contains(errString, "exit status 1") {
		return true
	}

	if strings.Contains(errString, context.Canceled.Error()) {
		return true
	}
	return false
}
