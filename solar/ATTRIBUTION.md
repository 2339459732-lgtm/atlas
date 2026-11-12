# 太阳系图集子应用 · 来源与许可

`/solar/`、`/planets/`、`/moons/`、`/sky/`、`/data/`、`/fonts/` 下的子应用
与资源镜像自 **Atlas of Space** 的公开构建（solar-system-atlas.pages.dev/solar/，
2026-11-13 归档），仅作自托管与品牌化适配，未修改其代码。

## 上游项目

- 项目：Atlas of Space — interactive exploration of the Solar System
- 作者：Gordon Hart
- 仓库：https://github.com/gordonhart/atlasof.space
- 许可：**Apache License 2.0**（见同目录 `LICENSE`）

## 数据与素材署名（由上游项目声明）

- 行星 / 卫星纹理：Solar System Scope（CC BY 4.0）
- 星空数据：NASA/GSFC SVS 4851「Deep Star Maps 2020」· Gaia DR2（ESA/Gaia/DPAC）
- 太阳影像：NASA SDO / AIA；太阳动力学影像 NASA SVS
- 小行星数据：JPL Small-Body Database
- 天体介绍：Wikidata Query Service
- 音频清单：melodysheep《The Arrow of Time》· 应用内以网易云音乐流式播放，
  本整合未镜像任何音频文件

## 适配说明（ATLAS 端注入，不修改上游文件）

- 主题变量映射：`--sx-accent → #C9A96A`（ATLAS 品牌金）等，经同源 iframe 注入样式表
- 品牌徽标与署名条：iframe 文档左下角，链接回 ATLAS 首页
- 懒加载：仅当用户切换到「太阳系」视图时才加载子应用
