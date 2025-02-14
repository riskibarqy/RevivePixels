package datatransfers

type VideoUpscalerRequest struct {
	InputPlainFileName string // filename without extension
	InputFullFileName  string
	InputFileExt       string // .mp4, .mkv etc
	InputFileSize      int64
	TempFilePath       string
	TempDir            string
	Model              string
	VideoFPS           int // if its not filled, it will automatically use default video fps
	AudioFileName      string
	ScaleMultiplier    int // realersgan params : scale multiplier 2, 3, 4 default : 4
	TileSize           int // Real-ESRGAN parameter: Default = 0 (auto). Higher values improve detail but increase GPU memory usage.
	SavePath           string
	IsHaveAudio        bool
}
