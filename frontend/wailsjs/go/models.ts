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

}

