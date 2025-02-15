import React, { useState, useEffect, useCallback, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { ProcessVideosFromUpload, CancelProcessing } from "../wailsjs/go/main/App";
import { EventsOn, EventsOff } from "../wailsjs/runtime";
import { motion } from "framer-motion";
import { Loader2, Upload, XCircle } from "lucide-react";
import  Button  from "./components/ui/button";

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
        const handler = (log) => setLogs((prevLogs) => [...prevLogs, log]);
        EventsOn("stderr_log", handler);
        return () => EventsOff("stderr_log", handler);
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
        onDrop,
    });

    const handleUpscale = async () => {
        if (selectedFiles.length === 0) {
            alert("Please select at least one file.");
            return;
        }
        setProcessing(true);
        setStatus(Object.fromEntries(selectedFiles.map((file) => [file.name, "Processing..."])));
        try {
            const fileDataPromises = selectedFiles.map((file) =>
                new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.readAsDataURL(file);
                    reader.onloadend = () => resolve(reader.result.split(",")[1]);
                    reader.onerror = reject;
                })
            );
            const filesBase64 = await Promise.all(fileDataPromises);
            const filenames = selectedFiles.map((file) => file.name);
            const result = await ProcessVideosFromUpload(filesBase64, filenames, selectedModel);
            setStatus(result);
            setLogs((prevLogs) => [...prevLogs, `Processing result: ${JSON.stringify(result)}`]);
        } catch (error) {
            setLogs((prevLogs) => [...prevLogs, error.name === "AbortError" ? "Processing was canceled." : `Error: ${error.message}`]);
        }
        setProcessing(false);
    };

    const handleCancel = () => {
        CancelProcessing();
        setProcessing(false);
        setStatus({});
        setElapsedTime(0);
        setLogs((prevLogs) => [...prevLogs, "Process canceled."]);
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 text-white p-6">
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
                className="w-full max-w-3xl p-6 bg-gray-800 rounded-2xl shadow-lg">
                <h1 className="text-4xl font-bold text-center mb-6">AI Video Upscaler</h1>
                <div {...getRootProps()}
                    className="border-2 border-dashed border-gray-500 rounded-lg p-6 text-center cursor-pointer hover:bg-gray-700 transition">
                    <input {...getInputProps()} />
                    <p className="text-lg flex items-center justify-center gap-2">
                        <Upload size={20} /> Drag & drop videos here, or click to select
                    </p>
                </div>
                {selectedFiles.length > 0 && (
                    <div className="mt-4 bg-gray-700 p-4 rounded-lg">
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
                    <Button onClick={handleUpscale} disabled={processing} className="w-full">
                        {processing ? <Loader2 className="animate-spin" /> : "Upscale Videos"} {processing && `(${elapsedTime}s)`}
                    </Button>
                    {processing && (
                        <Button onClick={handleCancel} variant="destructive" className="w-full">
                            <XCircle size={20} /> Cancel
                        </Button>
                    )}
                </div>
                <div ref={logContainerRef} className="mt-6 bg-black p-4 rounded-lg h-40 overflow-auto text-green-400">
                    <h2 className="text-lg font-semibold text-white">Terminal Logs:</h2>
                    <pre className="text-sm whitespace-pre-wrap">{logs.join("\n")}</pre>
                </div>
            </motion.div>
        </div>
    );
}

export default App;
