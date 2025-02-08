import React, { useState, useEffect, useCallback, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { OpenFiles, ProcessVideosFromUpload } from "../wailsjs/go/main/Upscaler";
import { EventsOn } from "../wailsjs/runtime";

function App() {
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [status, setStatus] = useState({});
    const [selectedModel, setSelectedModel] = useState("realesrgan-x4plus");
    const [logs, setLogs] = useState([]);
    const logContainerRef = useRef(null); // Create a ref for the log container

    // Listen for stderr logs from Wails
    useEffect(() => {
        EventsOn("stderr_log", (log) => {
            setLogs((prevLogs) => [...prevLogs, log]); // Append logs
        });
    }, []);

    // Auto-scroll to the bottom when logs update
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]); // Runs every time `logs` updates

    const onDrop = useCallback((acceptedFiles) => {
        console.log("Dropped files:", acceptedFiles);
        setSelectedFiles(acceptedFiles);
        setStatus({});
    }, []);

    const { getRootProps, getInputProps } = useDropzone({
        accept: { "video/*": [] }, // Accept only video files
        onDrop
    });

    const handleUpscale = async () => {
        if (selectedFiles.length === 0) {
            alert("Please select at least one file.");
            return;
        }

        setStatus((prev) =>
            Object.fromEntries(selectedFiles.map((file) => [file.name, "Processing..."]))
        );

        try {
            // Read files as Base64 strings
            const fileDataPromises = selectedFiles.map((file) => {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.readAsDataURL(file); // Convert to Base64
                    reader.onloadend = () => resolve(reader.result.split(",")[1]); // Extract only Base64 string
                    reader.onerror = reject;
                });
            });

            const filesBase64 = await Promise.all(fileDataPromises);
            const filenames = selectedFiles.map((file) => file.name);

            // Call Go backend
            const result = await ProcessVideosFromUpload(filesBase64, filenames, selectedModel);

            setStatus(result);
            setLogs((prevLogs) => [...prevLogs, `Processing result: ${JSON.stringify(result)}`]);
        } catch (error) {
            console.error("Error processing videos:", error);
            setLogs((prevLogs) => [...prevLogs, `Error: ${error.message}`]);
        }
    };



    return (
        <div class="container mx-auto">

            <div className="grid grid-cols-5 grid-rows-5 gap-4">
                <div className="col-span-5 bg-slate-500"> <h1 className="text-2xl font-bold">AI Video Upscaler</h1></div>
                <div className="col-span-2 row-span-2 row-start-2">
                    {/* Drag & Drop Area */}
                    <div
                        {...getRootProps()}
                        className="mt-4 w-96 h-32 border-2 border-dashed border-gray-400 rounded-lg flex items-center justify-center text-gray-500 cursor-pointer hover:bg-gray-100"
                    >
                        <input {...getInputProps()} />
                        <p>Drag & drop videos here, or click to select</p>
                    </div>

                    {/* Selected Files */}
                    {selectedFiles.length > 0 && (
                        <div className="mt-4">
                            <h2 className="text-lg font-semibold">Selected Files:</h2>
                            <ul className="list-disc pl-4">
                                {selectedFiles.map((file) => (
                                    <li key={file.name} className="text-sm">
                                        {file.name} - {status[file.name] || "Pending"}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
                <div className="col-span-2 row-span-2 col-start-3 row-start-2">
                    <label className="mt-4 border-l-orange-700">
                        <span className="mr-2">Upscale Model:</span>
                        <select
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                            className="border p-1"
                        >
                            <option value="realesr-animevideov3">realesr-animevideov3</option>
                            <option value="realesrgan-x4plus">realesrgan-x4plus</option>
                            <option value="realesrgan-x4plus-anime">realesrgan-x4plus-anime</option>
                            <option value="realesrnet-x4plus">realesrnet-x4plus</option>
                        </select>
                    </label>
                </div>
                <div className="col-span-4 row-span-2 col-start-1 row-start-4">            {/* Terminal Log Section */}
                    <div
                        ref={logContainerRef} // Attach ref to the log container
                        className="w-full max-w-2xl bg-black text-green-400 mt-6 p-3 rounded-lg h-40 overflow-auto"
                    >
                        <h2 className="text-lg font-semibold text-white">Terminal Logs:</h2>
                        <pre className="text-sm whitespace-pre-wrap">{logs.join("\n")}</pre>
                    </div></div>
                <div className="row-span-4 col-start-5 row-start-2 bg-red-300">                    <button onClick={handleUpscale} className="p-2 bg-blue-500 text-white rounded mt-4">
                    Upscale Videos
                </button></div>
            </div>

        </div>
    );
}

export default App;
