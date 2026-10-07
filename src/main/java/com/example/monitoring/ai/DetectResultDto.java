package com.example.monitoring.ai;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/** 视频识别接口返回结构，字段名需与前端 VideoDetect.tsx 对齐。 */
public record DetectResultDto(
        @JsonProperty("ok") boolean ok,
        @JsonProperty("filename") String filename,
        @JsonProperty("framesSampled") int framesSampled,
        @JsonProperty("maxScore") double maxScore,
        @JsonProperty("isFight") boolean isFight,
        @JsonProperty("fightFrames") int fightFrames,
        @JsonProperty("threshold") double threshold,
        @JsonProperty("timeline") List<TimelinePoint> timeline) {

    public record TimelinePoint(@JsonProperty("t") double t, @JsonProperty("score") double score) {
    }
}
