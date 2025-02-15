import React, { useState, useEffect, useCallback, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { ProcessVideosFromUpload } from "../wailsjs/go/main/App";
import { EventsOn,EventsOff } from "../wailsjs/runtime";

function App() {
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [status, setStatus] = useState({});
    const [selectedModel, setSelectedModel] = useState("realesrgan-x4plus");
    const [logs, setLogs] = useState([]);
    const [processing, setProcessing] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);
    const logContainerRef = useRef(null);
    const startTimeRef = useRef(null);
    let timer = useRef(null);

    useEffect(() => {
        const handler = (log) => {
            setLogs((prevLogs) => [...prevLogs, log]);
        };
    
        EventsOn("stderr_log", handler);
    
        return () => {
            EventsOff("stderr_log", handler); // Clean up listener
        };
    }, []);
    

    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    useEffect(() => {
        if (processing) {
            startTimeRef.current = Date.now();
            timer.current = setInterval(() => {
                setElapsedTime(((Date.now() - startTimeRef.current) / 1000).toFixed(1));
            }, 100);
        } else {
            clearInterval(timer.current);
        }
    }, [processing]);

    const onDrop = useCallback((acceptedFiles) => {
        setSelectedFiles(acceptedFiles);
        setStatus({});
    }, []);

    const { getRootProps, getInputProps } = useDropzone({
        accept: { "video/*": [] },
        onDrop
    });

    const handleUpscale = async () => {
        if (selectedFiles.length === 0) {
            alert("Please select at least one file.");
            return;
        }

        setProcessing(true);
        setStatus((prev) =>
            Object.fromEntries(selectedFiles.map((file) => [file.name, "Processing..."]))
        );

        try {
            const fileDataPromises = selectedFiles.map((file) => {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.readAsDataURL(file);
                    reader.onloadend = () => resolve(reader.result.split(",")[1]);
                    reader.onerror = reject;
                });
            });
            const filesBase64 = await Promise.all(fileDataPromises);
            const filenames = selectedFiles.map((file) => file.name);

            // Pass the abort signal to backend
            const result = await ProcessVideosFromUpload(filesBase64, filenames, selectedModel);

            setStatus(result);
            setLogs((prevLogs) => [...prevLogs, `Processing result: ${JSON.stringify(result)}`]);
        } catch (error) {
            if (error.name === "AbortError") {
                setLogs((prevLogs) => [...prevLogs, "Processing was canceled."]);
            } else {
                setLogs((prevLogs) => [...prevLogs, `Error: ${error.message}`]);
            }
        }
        setProcessing(false);
    };

    const handleCancel = () => {
        // CancelProcess()
        setProcessing(false);
        setStatus({});
        setElapsedTime(0);
        setLogs((prevLogs) => [...prevLogs, "Process canceled."]);
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
            <div className="w-4/5 max-w-4xl p-6 bg-gray-800 rounded-xl shadow-lg">
                <h1 className="text-3xl font-bold text-center mb-6">AI Video Upscaler</h1>
                <div {...getRootProps()} className="border-2 border-dashed border-gray-500 rounded-lg p-6 text-center cursor-pointer hover:bg-gray-700 transition">
                    <input {...getInputProps()} />
                    <p className="text-lg">Drag & drop videos here, or click to select</p>
                </div>
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
                <div className="mt-6">
                    <label className="block text-lg">Upscale Model:</label>
                    <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        className="mt-2 bg-gray-700 text-white p-2 rounded-lg w-full"
                    >
                        <option value="realesrgan-x4plus">realesrgan-x4plus</option>
                        <option value="realesrnet-x4plus">realesrnet-x4plus</option>
                        <option value="realesr-animevideov3">realesr-animevideov3</option>
                        <option value="realesrgan-x4plus-anime">realesrgan-x4plus-anime</option>
                    </select>
                </div>
                <div className="flex gap-3 mt-6">
                    <button
                        onClick={handleUpscale}
                        disabled={processing}
                        className={`w-full ${processing ? "bg-gray-600 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500"} text-white font-semibold p-3 rounded-lg transition`}
                    >
                        {processing ? `Processing... (${elapsedTime}s)` : "Upscale Videos"}
                    </button>
                    {/* TODO : ADD CANCEL BUTTON */}
                    {/* {processing && (
                        <button
                            onClick={handleCancel}
                            className="bg-red-600 hover:bg-red-500 text-white font-semibold p-3 rounded-lg transition"
                        >
                            Cancel
                        </button>
                    )} */}
                </div>
                <div ref={logContainerRef} className="mt-6 bg-black p-4 rounded-lg h-40 overflow-auto text-green-400">
                    <h2 className="text-lg font-semibold text-white">Terminal Logs:</h2>
                    <pre className="text-sm whitespace-pre-wrap">{logs.join("\n")}</pre>
                </div>
            </div>
        </div>
    );
}

export default App;