export namespace datatransfers {
	
	export class VideoUpscalerRequest {
	    FullFileName: string;
	    PlainFileName: string;
	    FileExtension: string;
	    TempFilePath: string;
	    Model: string;
	    VideoFPS: number;
	    AudioFileName: string;
	    ScaleMultiplier: number;
	    TileSize: number;
	    SavePath: string;
	
	    static createFrom(source: any = {}) {
	        return new VideoUpscalerRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.FullFileName = source["FullFileName"];
	        this.PlainFileName = source["PlainFileName"];
	        this.FileExtension = source["FileExtension"];
	        this.TempFilePath = source["TempFilePath"];
	        this.Model = source["Model"];
	        this.VideoFPS = source["VideoFPS"];
	        this.AudioFileName = source["AudioFileName"];
	        this.ScaleMultiplier = source["ScaleMultiplier"];
	        this.TileSize = source["TileSize"];
	        this.SavePath = source["SavePath"];
	    }
	}

}

