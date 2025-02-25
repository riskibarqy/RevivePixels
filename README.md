
# RevivePixels

**RevivePixels** is a Windows-only video upscaling application built with **Wails**, **Golang**, and **React** (using **TailwindCSS**). It utilizes **Real-ESRGAN NCNN Vulkan** for AI-based upscaling and **FFmpeg** for video processing, both of which are embedded within the application.

![apps-view](https://github.com/riskibarqy/RevivePixels/blob/main/assets/apps-view.png)

## Features

- **Lightweight** – Only ~300MB in size
- **Portable** – No installation required, just extract and run
- **AI-powered video upscaling** using [Real-ESRGAN NCNN Vulkan](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan)
- **Fast video processing** with [FFmpeg](https://ffmpeg.org/)
- **User-friendly UI** built with [React](https://react.dev/) and [TailwindCSS](https://tailwindcss.com/)
- **Windows-only** support

## ⚠️ System Requirements & Performance Warning  

- **High CPU & GPU usage** – The upscaling process is computationally intensive and may fully utilize your CPU and GPU.  
- **High RAM consumption** – Depending on the video resolution and upscaling settings, the app may require a significant amount of memory.  
- **Recommended hardware**: A modern NVIDIA GPU with Vulkan support and at least 16GB of RAM for smooth performance.  

*Processing time may vary based on resolution, model, and system load.*

## Benchmarking
I use RTX 3060 (12GB), 32GB RAM, AMD Ryzen 5 3600, with video length 5 seconds, using different model 

![Benchmark-capt-tsubasa](https://github.com/riskibarqy/RevivePixels/blob/main/assets/benchmark-image-capt-tsubasa.png)

Image Comparison
Original Image
![Benchmark-capt-tsubasa](https://github.com/riskibarqy/RevivePixels/blob/main/assets/original-image.png)
realesr-animevideov3-x2
![Benchmark-capt-tsubasa](https://github.com/riskibarqy/RevivePixels/blob/main/assets/realesr-animevideov3-x2.png)
realesr-animevideov3-x3
![Benchmark-capt-tsubasa](https://github.com/riskibarqy/RevivePixels/blob/main/assets/realesr-animevideov3-x3.png)
realesr-animevideov3-x4
![Benchmark-capt-tsubasa](https://github.com/riskibarqy/RevivePixels/blob/main/assets/realesr-animevideov3-x4.png)
realesrgan-x4plus
![Benchmark-capt-tsubasa](https://github.com/riskibarqy/RevivePixels/blob/main/assets/realesrgan-x4plus.png)
realesrnet-x4plus
![Benchmark-capt-tsubasa](https://github.com/riskibarqy/RevivePixels/blob/main/assets/realesrnet-x4plus.png)
realesrgan-x4plus-anime
![Benchmark-capt-tsubasa](https://github.com/riskibarqy/RevivePixels/blob/main/assets/realesrgan-x4plus-anime.png)

## Installation & Usage

1. Download the latest release from the [Releases](https://github.com/riskibarqy/RevivePixels/releases) page.
2. Extract the downloaded file.
3. Run `RevivePixels.exe`.

## Development

### Prerequisites

Before running the project locally, ensure you have installed:  

- **Golang** (latest version) → [Download](https://go.dev/dl/)  
- **React.js** (via Node.js & npm) → [Download](https://nodejs.org/)  
- **Wails** → [Installation Guide](https://wails.io/docs/gettingstarted/installation)  

### Run Locally

1. Clone the repository:

   ```sh
   git clone https://github.com/riskibarqy/RevivePixels.git
   cd RevivePixels
   ```

2. Start development mode
   ```sh 
   wails dev
   ```
3. To build the project :
   ```sh
   wails build
   ```

## Credits
This project is made possible by the following open-source technologies:

[Real-ESRGAN NCNN Vulkan](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan) – AI-powered video upscaling

[FFmpeg](https://www.ffmpeg.org/) – Video processing

[Wails](https://wails.io/) – Golang desktop application framework

[React](https://react.dev/) – Frontend UI

[TailwindCSS](https://tailwindcss.com/) – Styling framework

[Golang](https://go.dev/) – Backend logic
