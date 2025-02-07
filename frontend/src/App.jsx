import React, { useState } from "react";
import "./App.css";
import { OpenFiles, ProcessVideos } from "../wailsjs/go/main/Upscaler";

function App() {
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [status, setStatus] = useState({});
    const [selectedModel, setSelectedModel] = useState("realesrgan-x4plus");

    const handleFileSelect = async () => {
        try {
            const files = await OpenFiles();
            if (files.length > 0) {
                setSelectedFiles(files);
                setStatus({});
            }
        } catch (error) {
            console.error("Error selecting files:", error);
        }
    };

    const handleUpscale = async () => {
        if (selectedFiles.length === 0) {
            alert("Please select at least one file.");
            return;
        }

        setStatus((prev) =>
            Object.fromEntries(selectedFiles.map((file) => [file, "Processing..."]))
        );

        try {
            const result = await ProcessVideos(selectedFiles, selectedModel);
            setStatus(result);
        } catch (error) {
            console.error("Error processing videos:", error);
        }
    };

    return (
        <div className="flex flex-col items-center p-6">
            <h1 className="text-2xl font-bold">AI Video Upscaler</h1>

            <button onClick={handleFileSelect} className="p-2 bg-gray-500 text-white rounded">
                Select Video Files
            </button>

            {selectedFiles.length > 0 && (
                <div className="mt-4">
                    <h2 className="text-lg font-semibold">Selected Files:</h2>
                    <ul className="list-disc pl-4">
                        {selectedFiles.map((file) => (
                            <li key={file} className="text-sm">{file} - {status[file] || "Pending"}</li>
                        ))}
                    </ul>
                </div>
            )}

            <label className="mt-4">
                <span className="mr-2">Upscale Model:</span>
                <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} className="border p-1">
                    <option value="realesr-animevideov3">realesr-animevideov3</option>
                    <option value="realesrgan-x4plus">realesrgan-x4plus</option>
                    <option value="realesrgan-x4plus-anime">realesrgan-x4plus-anime</option>
                    <option value="realesrnet-x4plus">realesrnet-x4plus</option>
                </select>
            </label>

            <button onClick={handleUpscale} className="p-2 bg-blue-500 text-white rounded mt-4">
                Upscale Videos
            </button>
        </div>
    );
}

export default App;
