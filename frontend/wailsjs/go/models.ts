export namespace datatransfers {
	
	export class InputFileRequest {
	    FileCode: string;
	    FileBase64: string;
	    FileName: string;
	    Model: string;
	    Scale: number;
	
	    static createFrom(source: any = {}) {
	        return new InputFileRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.FileCode = source["FileCode"];
	        this.FileBase64 = source["FileBase64"];
	        this.FileName = source["FileName"];
	        this.Model = source["Model"];
	        this.Scale = source["Scale"];
	    }
	}
	export class VideoInfoResponse {
	    width: number;
	    height: number;
	    bitrate: number;
	    codec: string;
	    format: string;
	    frameRate: number;
	    duration: number;
	    totalFrames: number;
	
	    static createFrom(source: any = {}) {
	        return new VideoInfoResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.width = source["width"];
	        this.height = source["height"];
	        this.bitrate = source["bitrate"];
	        this.codec = source["codec"];
	        this.format = source["format"];
	        this.frameRate = source["frameRate"];
	        this.duration = source["duration"];
	        this.totalFrames = source["totalFrames"];
	    }
	}

}

