import { useState } from "react";
import "./App.css";
import { Process, OpenFile } from "../wailsjs/go/main/Upscaler"; // ✅ Import OpenFile

function App() {
    const [inputFile, setInputFile] = useState(null);
    const [status, setStatus] = useState("");

    const handleFileSelect = async () => {
        try {
            const filePath = await OpenFile(); // ✅ Calls Go function
            if (filePath) {
                console.log("Selected file path:", filePath);
                setInputFile(filePath);
            }
        } catch (error) {
            console.error("Error selecting file:", error);
            setStatus("Error selecting file.");
        }
    };

    const handleUpscale = async () => {
        if (!inputFile) {
            setStatus("Please select a file first.");
            return;
        }

        // Extract filename without extension
        const getFileNameWithoutExt = (path) => {
            const parts = path.split("/");
            const fileName = parts[parts.length - 1];
            return fileName.replace(/\.[^/.]+$/, ""); // Remove extension
        };

        // Generate a unique output filename
        const generateOutputFilename = (inputPath) => {
            const baseName = getFileNameWithoutExt(inputPath);
            const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, ""); // YYYYMMDDHHMMSS format
            const sequence = Math.floor(Math.random() * 1000); // Random sequence (000-999)
            return `/home/riskibarqy/Video/${baseName}_${timestamp}_${sequence}.mp4`;
        };

        const outputFile = generateOutputFilename(inputFile);
        try {
            console.log("Processing:", inputFile);
            setStatus("Processing");
            const result = await Process(inputFile, outputFile);
            setStatus(result);
        } catch (error) {
            console.error("Error processing video:", error);
            setStatus("Error processing video.");
        }
    };

    return (
        <div id="App">
            <div className="flex flex-col items-center p-4">
                <h1 className="text-2xl font-bold">AI Video Upscaler</h1>
                <button onClick={handleFileSelect} className="p-2 bg-gray-500 text-white rounded">
                    Select Video File
                </button>
                {inputFile && <p className="mt-2">Selected: {inputFile}</p>}
                <button onClick={handleUpscale} className="p-2 bg-blue-500 text-white rounded mt-2">
                    Upscale Video
                </button>
                <p className="mt-2">{status}</p>
            </div>
        </div>
    );
}

export default App;
