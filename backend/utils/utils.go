package utils

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
)

func HideWindowsCMD(cmd *exec.Cmd) {
	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	}
}

func GetOutputVideoFolder() (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", err
	}
	exeDir := filepath.Dir(exePath)
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

func GetSessionValue(sessionApps *sync.Map, key string) string {
	if value, ok := sessionApps.Load(key); ok {
		return value.(string)
	}
	return ""
}
