package models

type FFProbeOutput struct {
	Streams []struct {
		NbFrames   string `json:"nb_frames"`
		RFrameRate string `json:"r_frame_rate"`
	} `json:"streams"`
}
