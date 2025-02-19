package config

import (
	"fmt"
	"sync"

	"github.com/riskibarqy/RevivePixels/backend/constants"
)

type AppPaths struct {
	FFmpegPath     string
	FFprobePath    string
	RealEsrganPath string
}

var (
	Paths AppPaths
	once  sync.Once
)

// InitializePaths sets the paths only once
func InitializePaths(sessionApps *sync.Map) error {
	var err error
	once.Do(func() {
		ffmpegPath, ok1 := sessionApps.Load(constants.CtxFFmpegPath)
		ffprobePath, ok2 := sessionApps.Load(constants.CtxFFprobePath)
		realesrganPath, ok3 := sessionApps.Load(constants.CtxRealesrganPath)

		if !ok1 || !ok2 || !ok3 {
			err = fmt.Errorf("missing paths in sessionApps")
			return
		}

		Paths = AppPaths{
			FFmpegPath:     ffmpegPath.(string),
			FFprobePath:    ffprobePath.(string),
			RealEsrganPath: realesrganPath.(string),
		}
	})
	return err
}
