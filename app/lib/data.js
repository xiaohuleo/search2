// app/lib/data.js

const RAW_TEXT = `
居民身份证住址变更换领，居民身份证损坏换领，居民身份证民族变更更正换领，居民身份证姓名变更换领，居民身份证到期换领，居民身份证遗失补领，码上监督码上办，政策通，个人中心-办事记录，个人中心-我的留言，人工总客服，视频预约，二级注册造价师证书，个体经营者，怀化二手房网签查询，怀化房源验真，怀化楼盘查询，怀化商品房网签查询，企业异常名录详细信息，企业养老，食品生产许可证，失业保险个人信息，烟草专卖批发企业许可证，一级注册建造师信息，严重违法失信企业名单，中华人民共和国二级建造师注册证书，中华人民共和国二级注册结构工程师注册执业，中华人民共和国二级注册建筑师注册证书，食安包保督导问题整改，制定食安风险防控清单，食安企业防控问题整改，检查问题食安企业整改，食安日管控，食安人员管理，食安人员培训，食安企业索证索票，食安企业停工停产申请，食安企业调休时间配置，食安通知公告查询，食安消毒留样记录管理，食安月调度，预警信息管理，食安自检自查，食安周排查，食安责任人管理，食品企业信息报备，食品企业追溯拆码，食品企业产品入库，食品企业产品出库，食品企业产品库存，食品企业原料入库，食品企业证书申报，用户个人中心，入驻商户列表，放心消费地图，创业孵化与指导，新生儿出生一件事，生育登记，出生医学证明办理，灵活就业人员参保，公积金提取，公积金贷款，不动产登记，居住证办理，医保报销，跨省异地就医备案，老年人优待证，高龄津贴，残疾人两项补贴，就业困难人员认定，失业登记，企业开办一窗通，税务注销，发票申领，长沙住房公积金查询，株洲不动产登记，湘潭社保查询，衡阳公积金提取，邵阳新生儿重名查询，岳阳景区预约，常德公交卡办理，张家界旅游投诉，益阳银城码，郴州公积金贷款，永州不动产查询，怀化入学报名，娄底中考成绩查询，湘西社保卡申领
`;

// 湖南省 14 个市州标准列表
const HUNAN_CITIES = ["长沙", "株洲", "湘潭", "衡阳", "邵阳", "岳阳", "常德", "张家界", "益阳", "郴州", "永州", "怀化", "娄底", "湘西"];

// 辅助函数：从名称中提取城市
function getCityFromName(name) {
  for (let city of HUNAN_CITIES) {
    if (name.includes(city)) return city + "市"; // 简单补全
  }
  if (name.includes("湘西")) return "湘西土家族苗族自治州";
  return "湖南省本级";
}

// 辅助函数：生成随机评分 8.0 - 10.0
function getRandomScore() {
  return (Math.random() * 2 + 8).toFixed(1);
}

// 辅助函数：生成模拟的高频访问量
function getRandomVisits() {
  const rand = Math.random();
  if (rand > 0.95) return Math.floor(Math.random() * 5000000) + 100000;
  if (rand > 0.8) return Math.floor(Math.random() * 100000) + 10000;
  return Math.floor(Math.random() * 5000) + 100;
}

// 辅助函数：随机生成发布渠道组合
function getRandomChannels() {
  const allChannels = ["Android", "IOS", "HarmonyOS", "微信小程序", "支付宝小程序", "PC端", "自助终端"];
  // 随机取 1-5 个渠道
  const count = Math.floor(Math.random() * 5) + 1; 
  const shuffled = allChannels.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count).join(",");
}

export const DEFAULT_DATA = RAW_TEXT.split(/，|\n/)
  .map(s => s.trim())
  .filter(s => s.length > 0)
  .map((name, index) => {
    const isLegal = (name.includes("企业") || name.includes("法人") || name.includes("公司") || name.includes("经营") || name.includes("许可证"));
    const city = getCityFromName(name);
    
    return {
      "事项编码": `SV-${10000 + index}`,
      "事项名称": name,
      "事项简称": name.length > 8 ? name.substring(0, 8) + "..." : name,
      "状态": "正常",
      "申请人": isLegal ? "法人/非法人组织" : "自然人",
      "最新更新时间": new Date().toLocaleDateString(),
      "申请时间": "工作日 9:00-17:00",
      "所属应用": "政务APP",
      "事项分类": isLegal ? "准营准办" : "便民服务",
      "服务对象": isLegal ? "法人" : "自然人",
      "自然人主题": isLegal ? "" : "户籍办理",
      "法人主题": isLegal ? "设立变更" : "",
      "所属市州单位": city,
      "办理权限": "市级",
      "事项标签": isLegal ? "营商环境" : "民生保障",
      "是否高频事项": Math.random() > 0.8 ? "是" : "否",
      "发布渠道": getRandomChannels(), // 生成多渠道数据
      "满意度": getRandomScore(),
      "访问量": getRandomVisits().toString()
    };
  });
